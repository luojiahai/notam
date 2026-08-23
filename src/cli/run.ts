import {
	defaultConfigPath,
	defaultDbPath,
	loadConfig,
	resolveToken,
} from "../core/config/load.ts";
import { refreshPromotions } from "../core/promotion/refresh.ts";
import { createApp } from "../server/app.ts";
import { type AppContext, createContext } from "../server/context.ts";
import { listen } from "../server/listen.ts";
import {
	defaultWebDistPath,
	loadAssetsFromDirectory,
} from "../server/static.ts";
import { applyConfig } from "../store/bootstrap.ts";
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
};

export type RunningServer = {
	url: string;
	port: number;
	ctx: AppContext;
	stop: () => Promise<void>;
};

function launchBrowser(url: string): void {
	const command =
		process.platform === "darwin" ? ["open", url] : ["xdg-open", url];
	try {
		Bun.spawn(command, { stdout: "ignore", stderr: "ignore" });
	} catch {
		// Headless machines and minimal containers have neither. The URL is
		// already printed; that is enough.
	}
}

/**
 * The whole boot sequence, separated from `runRun` so tests can start a real
 * server, drive it over HTTP, and stop it.
 *
 * Order matters. Config and tokens are validated before the database is
 * touched, so a typo cannot leave a half-migrated file behind; and both are
 * validated before the socket is bound, so a failure is a message on stderr
 * rather than a browser tab pointed at a broken server.
 */
export async function startServer(options: RunOptions): Promise<RunningServer> {
	const env = options.env ?? process.env;
	const configPath = defaultConfigPath(options.home);
	const dbPath = defaultDbPath(options.home);

	const config = await loadConfig(configPath);
	// Resolve every token up front: the promotion routes build their clients
	// lazily, so without this a missing variable would first surface as an HTTP
	// 500 mid-session instead of a named refusal to start.
	for (const host of config.hosts) resolveToken(host, env);

	const { db, applied, backup } = await migrateDatabase(dbPath);
	// Everything from here on can throw with the database already open — a
	// UNIQUE violation from applyConfig, an unreadable web/dist, an explicit
	// --port that is taken — so the whole block unwinds as one, the way
	// runSync's own try/finally does.
	let ctx: AppContext | undefined;
	try {
		if (backup) {
			options.log(
				`Backed up the database to ${backup} before applying ${applied} migration(s).`,
			);
		}

		const now = () => new Date();
		applyConfig(db, config, now());

		ctx = createContext({ db, config, configPath, dbPath, now, env });
		for (const warning of ctx.warnings) options.log(`Warning: ${warning}`);

		// Plan 1's guarantee: anything left `running` belongs to a process that
		// died. Reclaiming alone only returns them to `queued`; the kick below is
		// what actually resumes them, so a Ctrl-C mid-analysis does not leave work
		// stranded until the user happens to press an unrelated button.
		const reclaimed = ctx.queue.resetStale();
		if (reclaimed > 0) {
			options.log(
				`Reclaimed ${reclaimed} job(s) left running by a previous process.`,
			);
			ctx.syncRunner.kick();
			ctx.analyseRunner.kick();
		}

		const assets = await loadAssetsFromDirectory(defaultWebDistPath(env));
		const app = createApp(ctx, assets);

		const listener = listen({
			fetch: app.fetch,
			port: options.port ?? config.server.port,
			autoIncrement: options.port === undefined,
		});

		// Spec section 7: the status refresh runs on app open. It is fire-and-forget
		// because a GitHub outage must not stop the server from coming up, and it
		// costs nothing when there are no open promotions.
		void refreshPromotions(ctx.promotionDeps).catch((error: unknown) => {
			options.log(
				`Could not refresh promotion status: ${
					error instanceof Error ? error.message : String(error)
				}`,
			);
		});

		if (options.open) (options.openBrowser ?? launchBrowser)(listener.url);

		const started = ctx;
		return {
			url: listener.url,
			port: listener.port,
			ctx: started,
			stop: async () => {
				started.shutdown();
				// The abort only signals; a handler mid-statement still holds the
				// database. Closing under it would throw inside the drain, where
				// nothing surfaces it, and leave the job `running` for the next
				// boot to reclaim.
				await Promise.all([
					started.syncRunner.idle(),
					started.analyseRunner.idle(),
				]);
				await listener.stop();
				db.close();
			},
		};
	} catch (error) {
		ctx?.shutdown();
		db.close();
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
