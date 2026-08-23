import {
	ConfigError,
	defaultConfigPath,
	defaultDbPath,
	loadConfig,
	resolveToken,
} from "../core/config/load.ts";
import { GraphQLGitHubClient } from "../core/github/client.ts";
import { createSyncHandler, type SyncSummary } from "../core/sync/index.ts";
import { runPool } from "../jobs/pool.ts";
import { JobQueue } from "../jobs/queue.ts";
import type { HostRow } from "../shared/types.ts";
import { applyConfig } from "../store/bootstrap.ts";
import { migrateDatabase } from "../store/migrations.ts";

export type SyncOptions = {
	home: string;
	repoFilter?: string;
	concurrency: number;
	log: (line: string) => void;
};

/** Returns the number of failed jobs, which the CLI turns into an exit code. */
export async function runSync({
	home,
	repoFilter,
	concurrency,
	log,
}: SyncOptions): Promise<number> {
	const config = await loadConfig(defaultConfigPath(home));

	// Resolve every token up front: a missing variable must fail before any
	// network call, not halfway through a repository.
	const tokens = new Map<string, string>();
	for (const host of config.hosts) tokens.set(host.id, resolveToken(host));

	const { db, applied, backup } = await migrateDatabase(defaultDbPath(home));
	if (backup)
		log(
			`Backed up the database to ${backup} before applying ${applied} migration(s).`,
		);

	const now = () => new Date();
	const { repos } = applyConfig(db, config, now());
	const selected = repoFilter
		? repos.filter((repo) => repo.name === repoFilter)
		: repos;
	if (selected.length === 0) {
		throw new ConfigError(
			repoFilter
				? `No repository named "${repoFilter}" in your config.\nConfigured: ${repos.map((r) => r.name).join(", ") || "(none)"}`
				: "No repositories are configured.",
		);
	}

	const queue = new JobQueue(db, now);
	const reclaimed = queue.resetStale();
	if (reclaimed > 0)
		log(`Reclaimed ${reclaimed} job(s) left running by a previous process.`);
	for (const repo of selected) queue.enqueue("sync", repo.id);

	const clientFor = (host: HostRow) =>
		new GraphQLGitHubClient({
			endpoint: host.graphql,
			token: tokens.get(host.id) ?? "",
			onRateLimitPause: ({ waitMs, reason }) =>
				log(`Paused ${Math.round(waitMs / 1000)}s — ${reason}`),
		});

	const summaries: SyncSummary[] = [];
	const result = await runPool({
		queue,
		concurrency,
		handlers: {
			sync: createSyncHandler({ db, clientFor, now }, (summary) => {
				summaries.push(summary);
				log(
					`${summary.repo}: ${summary.created} new, ${summary.updated} updated, ${summary.skipped} skipped` +
						(summary.truncated > 0
							? `, ${summary.truncated} with a truncated file list`
							: ""),
				);
			}),
		},
	});

	for (const job of queue.list("failed"))
		log(`FAILED ${job.target_id}: ${job.error ?? "unknown error"}`);

	const created = summaries.reduce((sum, s) => sum + s.created, 0);
	const updated = summaries.reduce((sum, s) => sum + s.updated, 0);
	log("");
	log(
		`Synced ${summaries.length}/${selected.length} repositories — ${created} new entries, ${updated} updated.`,
	);
	db.close();
	return result.failed;
}
