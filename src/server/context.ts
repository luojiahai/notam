import type { Database } from "bun:sqlite";
import {
	type AnalysisDeps,
	createAnalyseHandler,
} from "../core/analysis/index.ts";
import {
	type ClaudeRunner,
	createClaudeRunner,
} from "../core/analysis/runner.ts";
import { resolveToken } from "../core/config/load.ts";
import type { Config } from "../core/config/schema.ts";
import { GraphQLGitHubClient } from "../core/github/client.ts";
import { RestGitHubClient } from "../core/github/rest.ts";
import type { GitDataClient, GitHubClient } from "../core/github/types.ts";
import type { PromotionDeps } from "../core/promotion/index.ts";
import { createSyncHandler } from "../core/sync/index.ts";
import { JobQueue } from "../jobs/queue.ts";
import type { ServerEvent } from "../shared/api.ts";
import type { HostRow } from "../shared/types.ts";
import { getEntry } from "../store/entries.ts";
import { listRepos } from "../store/repos.ts";
import { VERSION } from "../version.ts";
import { EventBus } from "./events.ts";
import { JobRunner } from "./runner.ts";

export type ContextOptions = {
	db: Database;
	config: Config;
	configPath: string;
	dbPath: string;
	now?: () => Date;
	env?: Record<string, string | undefined>;
	/** Injected by tests. Production builds a GraphQLGitHubClient per host. */
	githubFor?: (host: HostRow) => GitHubClient;
	/** Injected by tests. Production builds a RestGitHubClient per host. */
	gitDataFor?: (host: HostRow) => GitDataClient;
	claudeRunner?: ClaudeRunner;
	/** Checked once at boot rather than per call; see spec section 14. */
	claudeAvailable?: boolean;
	version?: string;
};

export type AppContext = {
	db: Database;
	config: Config;
	configPath: string;
	dbPath: string;
	now: () => Date;
	bus: EventBus;
	queue: JobQueue;
	/** Two runners so a long sync can never eat the configured analysis concurrency. */
	syncRunner: JobRunner;
	analyseRunner: JobRunner;
	promotionDeps: PromotionDeps;
	claudeAvailable: boolean;
	warnings: string[];
	version: string;
	shutdown: () => void;
};

/**
 * Wires plans 1 and 2 together and hands the result to the routes.
 *
 * Every edge that leaves the process — GitHub over GraphQL, GitHub over REST,
 * the `claude` subprocess — arrives here as an injectable function, so the
 * whole server can be exercised with `app.request()` and no network and no
 * subprocess. That is the only reason the route tests are cheap.
 *
 * This is also where plan 2's named handoff is discharged: `analysis.concurrency`,
 * `analysis.timeout_seconds`, and `analysis.model` are read from the config and
 * pushed into the analyse runner and the analysis deps. Nothing else reads them.
 */
export function createContext(options: ContextOptions): AppContext {
	const { db, config } = options;
	const now = options.now ?? (() => new Date());
	const env = options.env ?? process.env;
	const version = options.version ?? VERSION;
	const bus = new EventBus();
	const queue = new JobQueue(db, now);

	// Resolved against the injected env's PATH, not the process's, so a test can
	// produce the missing-CLI state deterministically.
	const claudeAvailable =
		options.claudeAvailable ??
		Bun.which("claude", { PATH: env.PATH ?? "" }) !== null;
	const warnings: string[] = [];
	if (!claudeAvailable) {
		warnings.push(
			"The claude CLI was not found on PATH. Sync works, but analysis will fail until you install it from https://claude.com/claude-code",
		);
	}

	const hostConfig = (host: HostRow) => ({
		id: host.id,
		label: host.label,
		api_base: host.api_base,
		graphql: host.graphql,
		token_env: host.token_env,
	});

	const githubFor =
		options.githubFor ??
		((host: HostRow) =>
			new GraphQLGitHubClient({
				endpoint: host.graphql,
				token: resolveToken(hostConfig(host), env),
			}));

	const gitDataFor =
		options.gitDataFor ??
		((host: HostRow) =>
			new RestGitHubClient({
				apiBase: host.api_base,
				token: resolveToken(hostConfig(host), env),
			}));

	const publish = (event: ServerEvent) => bus.publish(event);
	const publishBatch = () =>
		publish({
			type: "batch",
			queued: queue.count("queued"),
			running: queue.count("running"),
		});

	/** The analyser reports entry ids; the browser filters by repository. */
	const repoOf = (entryId: string): string =>
		getEntry(db, entryId)?.repo_id ?? "";

	const analysisDeps: AnalysisDeps = {
		db,
		now,
		runner: options.claudeRunner ?? createClaudeRunner({ env }),
		timeoutMs: config.analysis.timeout_seconds * 1000,
		model: config.analysis.model,
		onProgress: (event) => {
			const repo_id = repoOf(event.entryId);
			if (event.type === "started") {
				publish({
					type: "entry",
					repo_id,
					entry_id: event.entryId,
					state: "running",
					error: null,
				});
			} else if (event.type === "analysed") {
				publish({
					type: "entry",
					repo_id,
					entry_id: event.entryId,
					state: "analysed",
					error: null,
				});
				publish({ type: "rules", repo_id });
			} else if (event.type === "failed") {
				publish({
					type: "entry",
					repo_id,
					entry_id: event.entryId,
					state: "failed",
					error: event.error,
				});
			}
			// "attempt" and "repairing" are diagnostics with no slot in the wire
			// contract; the entry's own state already tells the table what to show.
		},
	};

	// A drain-level throw is not a job failure — no entry row records it — so
	// without this it vanishes entirely. The terminal is the only console this
	// process has.
	const onDrainError = (error: unknown) => {
		console.error("Job runner drain failed:", error);
	};

	const analyseRunner = new JobRunner({
		queue,
		concurrency: config.analysis.concurrency,
		handlers: { analyse: createAnalyseHandler(analysisDeps) },
		onEvent: publishBatch,
		onError: onDrainError,
	});

	const syncRunner = new JobRunner({
		queue,
		// Repositories are few and each sync is mostly waiting on GitHub, so two
		// at a time is plenty and keeps the rate-limit backoff comprehensible.
		concurrency: 2,
		handlers: {
			sync: createSyncHandler({ db, clientFor: githubFor, now }, (summary) => {
				publish({
					type: "sync",
					repo_id: repoIdByName(db, summary.repo) ?? "",
					phase: "finished",
					created: summary.created,
					updated: summary.updated,
					skipped: summary.skipped,
					error: null,
				});
			}),
		},
		onEvent: (event) => {
			publishBatch();
			if (event.job.kind !== "sync") return;
			if (event.type === "started") {
				publish({
					type: "sync",
					repo_id: event.job.target_id,
					phase: "started",
					created: 0,
					updated: 0,
					skipped: 0,
					error: null,
				});
			} else if (event.type === "failed") {
				publish({
					type: "sync",
					repo_id: event.job.target_id,
					phase: "failed",
					created: 0,
					updated: 0,
					skipped: 0,
					error: event.error,
				});
			}
		},
		onError: onDrainError,
	});

	const promotionDeps: PromotionDeps = { db, clientFor: gitDataFor, now };

	return {
		db,
		config,
		configPath: options.configPath,
		dbPath: options.dbPath,
		now,
		bus,
		queue,
		syncRunner,
		analyseRunner,
		promotionDeps,
		claudeAvailable,
		warnings,
		version,
		shutdown: () => {
			syncRunner.stop();
			analyseRunner.stop();
		},
	};
}

/**
 * `SyncSummary` carries the repository's `owner/repo` name, because that is
 * what a CLI summary line prints. The browser keys everything by id, so the
 * name is resolved back here rather than widening the core summary type.
 */
function repoIdByName(db: Database, name: string): string | null {
	return listRepos(db).find((repo) => repo.name === name)?.id ?? null;
}
