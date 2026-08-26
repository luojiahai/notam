import type { Database } from "bun:sqlite";
import {
	defaultConfigPath,
	defaultDbPath,
	ensureConfig,
	loadConfig,
} from "../core/config/load.ts";
import { refreshPromotions } from "../core/promotion/refresh.ts";
import { createApp } from "../server/app.ts";
import { resolveAssets } from "../server/assets.ts";
import { type AppContext, createContext } from "../server/context.ts";
import { type Listener, listen } from "../server/listen.ts";
import { applyConfig } from "../store/bootstrap.ts";
import { requeueRunningEntries } from "../store/entries.ts";
import { migrateDatabase } from "../store/migrations.ts";

export type RunOptions = {
	home: string;
	/** An explicit --port. Undefined means "use the config's, and auto-increment". */
	port?: number;
	open: boolean;
	log: (line: string) => void;
	env?: Record<string, string | undefined>;
	/** Injected so no test ever launches a browser. */
	openBrowser?: (url: string) => void;
	/** Injected by tests so a stalled-drain assertion need not take seconds. */
	drainTimeoutMs?: number;
};

export type RunningServer = {
	url: string;
	port: number;
	ctx: AppContext;
	stop: () => Promise<void>;
};

/**
 * How long shutdown waits for in-flight jobs before closing the database
 * anyway.
 *
 * A runner's AbortSignal only gates claiming the *next* job; a handler already
 * inside a stalled GitHub connection is not interruptible from here, and the
 * clients issue their requests without a signal of their own. Waiting forever
 * would make Ctrl-C hostage to a hung socket, so the drain is best effort:
 * whatever is still running when this elapses is left `running` and reclaimed
 * by the next boot, which is exactly the state a crash produces anyway.
 */
export const SHUTDOWN_DRAIN_TIMEOUT_MS = 5_000;

/**
 * The one way this module tears a booted server down, used by both `stop()` and
 * the boot failure path, so neither can drift into closing the database under a
 * running handler or leaving a bound socket behind.
 */
async function shutdownServer(
	ctx: AppContext,
	db: Database,
	listener: Listener | undefined,
	timeoutMs: number,
): Promise<void> {
	ctx.shutdown();
	let timer: ReturnType<typeof setTimeout> | undefined;
	await Promise.race([
		Promise.all([ctx.syncRunner.idle(), ctx.analyseRunner.idle()]),
		new Promise<void>((resolve) => {
			timer = setTimeout(resolve, timeoutMs);
		}),
	]);
	// Otherwise a drain that finished early keeps the process alive for the rest
	// of the timeout.
	if (timer !== undefined) clearTimeout(timer);
	await listener?.stop();
	db.close();
}

/** The opener for this platform, or null where there is none to call. */
function opener(): string | null {
	const command = process.platform === "darwin" ? "open" : "xdg-open";
	return Bun.which(command) === null ? null : command;
}

/**
 * Whether launching a browser could possibly be what the user wanted.
 *
 * `notam` with no arguments is now the whole command, so this default applies
 * to every start rather than to one subcommand somebody opted into. Over SSH or
 * with output piped there is no browser to open on the machine that would open
 * it, and on a headless box `xdg-open` is usually absent or fails into a void.
 * The URL is printed either way, which is the part that actually matters.
 */
export function canOpenBrowser(
	env: Record<string, string | undefined>,
	isTTY: boolean,
): boolean {
	if (!isTTY) return false;
	if (env.SSH_CONNECTION || env.SSH_TTY) return false;
	return opener() !== null;
}

function launchBrowser(
	url: string,
	env: Record<string, string | undefined>,
): void {
	if (!canOpenBrowser(env, process.stdout.isTTY)) return;
	const command = opener();
	if (command === null) return;
	try {
		Bun.spawn([command, url], { stdout: "ignore", stderr: "ignore" });
	} catch {
		// Nothing to report: the URL is already on stdout.
	}
}

/**
 * The whole boot sequence, separated from `runRun` so tests can start a real
 * server, drive it over HTTP, and stop it.
 *
 * Order matters. Config is created if absent and validated before the database
 * is touched, so a typo cannot leave a half-migrated file behind, and it is
 * validated before the socket is bound, so a failure is a message on stderr
 * rather than a browser tab pointed at a broken server.
 *
 * Tokens are not part of that gate. A host whose `token_env` is unset becomes
 * a warning and a 503 on the routes that need it, because the settings drawer
 * is where a token_env is corrected and a server that refuses to boot cannot
 * serve the page that corrects it.
 */
export async function startServer(options: RunOptions): Promise<RunningServer> {
	const env = options.env ?? process.env;
	const configPath = defaultConfigPath(options.home);
	const dbPath = defaultDbPath(options.home);

	// Creates, never repairs: a file that exists but does not parse is left
	// alone for loadConfig to report, because overwriting it would destroy
	// whatever the user was in the middle of writing.
	if (await ensureConfig(configPath)) {
		options.log(`Wrote ${configPath}`);
	}
	const config = await loadConfig(configPath);

	const { db, applied, backup } = await migrateDatabase(dbPath);
	// Everything from here on can throw with the database already open — a
	// UNIQUE violation from applyConfig, an unreadable web/dist, an explicit
	// --port that is taken — so the whole block unwinds as one, the way
	// runSync's own try/finally does.
	const drainTimeoutMs = options.drainTimeoutMs ?? SHUTDOWN_DRAIN_TIMEOUT_MS;
	let ctx: AppContext | undefined;
	let listener: Listener | undefined;
	try {
		if (backup) {
			options.log(
				`Backed up the database to ${backup} before applying ${applied} migration(s).`,
			);
		}

		const now = () => new Date();
		applyConfig(db, config, now());

		ctx = createContext({
			db,
			config,
			configPath,
			dbPath,
			home: options.home,
			now,
			env,
		});
		for (const warning of ctx.warnings) options.log(`Warning: ${warning}`);

		// Anything left `running` belongs to a process that died. Reclaiming
		// alone only returns them to `queued`; the kick below is what actually
		// resumes them, so a Ctrl-C mid-analysis does not leave work stranded
		// until the user happens to press an unrelated button.
		const reclaimed = ctx.queue.resetStale();
		// Not conditional on this start reclaiming anything: an entry can already
		// be stranded `running` with its job back in the queue, left there by a
		// process that exited between the two writes, and nothing else ever puts
		// the pair back in step.
		requeueRunningEntries(db);
		if (reclaimed > 0) {
			options.log(
				`Reclaimed ${reclaimed} job(s) left running by a previous process.`,
			);
			ctx.syncRunner.kick();
			ctx.analyseRunner.kick();
		}

		const assets = await resolveAssets(env);
		const app = createApp(ctx, assets);

		listener = listen({
			fetch: app.fetch,
			port: options.port ?? config.server.port,
			autoIncrement: options.port === undefined,
		});

		// The status refresh runs on app open. It is fire-and-forget because a
		// GitHub outage must not stop the server from coming up, and it
		// costs nothing when there are no open promotions.
		void refreshPromotions(ctx.promotionDeps).catch((error: unknown) => {
			options.log(
				`Could not refresh promotion status: ${
					error instanceof Error ? error.message : String(error)
				}`,
			);
		});

		// An injected opener is a test saying it owns this decision, so the
		// environment checks live inside the default one rather than here.
		if (options.open) {
			(options.openBrowser ?? ((url) => launchBrowser(url, env)))(listener.url);
		}

		const started = ctx;
		const bound = listener;
		return {
			url: bound.url,
			port: bound.port,
			ctx: started,
			// The abort only signals; a handler mid-statement still holds the
			// database. Closing under it would throw inside the drain, where
			// nothing surfaces it, and leave the job `running` for the next boot
			// to reclaim.
			stop: () => shutdownServer(started, db, bound, drainTimeoutMs),
		};
	} catch (error) {
		// The same teardown as `stop()`: the reclaim above may already have
		// kicked a handler into flight, and `listen` may already have bound.
		if (ctx) await shutdownServer(ctx, db, listener, drainTimeoutMs);
		else db.close();
		throw error;
	}
}

/** Blocks until SIGINT or SIGTERM, then shuts down cleanly. */
export async function runRun(options: RunOptions): Promise<number> {
	const server = await startServer(options);
	options.log(`NOTAM is running at ${server.url}`);
	options.log("Press Ctrl-C to stop.");

	await new Promise<void>((resolve) => {
		const stop = () => resolve();
		process.once("SIGINT", stop);
		process.once("SIGTERM", stop);
	});

	options.log("");
	options.log("Shutting down.");
	await server.stop();
	return 0;
}
