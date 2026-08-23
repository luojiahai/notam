import type { Database } from "bun:sqlite";
import type { JobHandler } from "../../jobs/pool.ts";
import type { HostRow, RepoRow } from "../../shared/types.ts";
import { upsertEntry } from "../../store/entries.ts";
import { getHost } from "../../store/hosts.ts";
import { getRepo, setWatermark } from "../../store/repos.ts";
import { type GitHubClient, parseRepoName } from "../github/types.ts";
import { matchesGlobs } from "./globs.ts";
import { normalisePR } from "./normalise.ts";

export type SyncEvent =
	| { type: "page"; scanned: number }
	| { type: "stored"; number: number; created: boolean }
	| { type: "skipped"; number: number; reason: "globs" };

export type SyncSummary = {
	repo: string;
	scanned: number;
	created: number;
	updated: number;
	skipped: number;
	truncated: number;
	watermark: string | null;
};

export type SyncDeps = {
	db: Database;
	clientFor: (host: HostRow) => GitHubClient;
	now: () => Date;
	pageSize?: number;
	onProgress?: (event: SyncEvent) => void;
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** All timestamp comparisons go through this, so `...Z` and `....000Z` compare correctly. */
function iso(timestamp: string): string {
	return new Date(timestamp).toISOString();
}

/**
 * Spec section 5. Lists merged PRs newest-first and walks back until updated_at
 * drops below max(watermark, now - window_days).
 *
 * The watermark is written once, after pagination terminates, and never
 * per-page: the listing descends, so committing page 1's maximum before page 3
 * has been fetched would make an interrupted run *skip* pages 2 and 3 on the
 * next attempt. Leaving it unmoved means an interrupted run re-covers ground it
 * already has, which is cheap and safe because the entry upsert is idempotent
 * and never touches analysis_state.
 */
export async function syncRepo(
	deps: SyncDeps,
	repo: RepoRow,
): Promise<SyncSummary> {
	const host = getHost(deps.db, repo.host_id);
	if (!host)
		throw new Error(
			`repo ${repo.name} references unknown host "${repo.host_id}"`,
		);

	const client = deps.clientFor(host);
	const ref = parseRepoName(repo.name);
	const windowStart = new Date(
		deps.now().getTime() - repo.window_days * DAY_MS,
	).toISOString();
	const floor =
		repo.sync_watermark && repo.sync_watermark > windowStart
			? repo.sync_watermark
			: windowStart;

	const summary: SyncSummary = {
		repo: repo.name,
		scanned: 0,
		created: 0,
		updated: 0,
		skipped: 0,
		truncated: 0,
		watermark: repo.sync_watermark,
	};

	let cursor: string | undefined;
	let highest: string | null = null;
	let reachedFloor = false;

	while (!reachedFloor) {
		const page = await client.listMergedPRs(ref, {
			cursor,
			pageSize: deps.pageSize,
		});
		deps.onProgress?.({ type: "page", scanned: page.nodes.length });

		for (const node of page.nodes) {
			const updatedAt = iso(node.updatedAt);
			if (updatedAt < floor) {
				reachedFloor = true;
				break;
			}
			summary.scanned++;
			if (!highest || updatedAt > highest) highest = updatedAt;

			const detail = await client.fetchPRDetail(ref, node.number);
			const entry = normalisePR(detail);

			if (!matchesGlobs(entry.changed_paths, repo.path_globs)) {
				summary.skipped++;
				deps.onProgress?.({
					type: "skipped",
					number: entry.number,
					reason: "globs",
				});
				continue;
			}

			const result = upsertEntry(deps.db, repo.id, entry, deps.now());
			if (result.created) summary.created++;
			else summary.updated++;
			if (entry.paths_truncated) summary.truncated++;
			deps.onProgress?.({
				type: "stored",
				number: entry.number,
				created: result.created,
			});
		}

		if (reachedFloor || !page.hasNextPage || !page.endCursor) break;
		cursor = page.endCursor;
	}

	if (highest && (!repo.sync_watermark || highest > repo.sync_watermark)) {
		setWatermark(deps.db, repo.id, highest);
		summary.watermark = highest;
	}
	return summary;
}

/** Adapts syncRepo to the worker pool: a `sync` job's target_id is a repo id. */
export function createSyncHandler(
	deps: SyncDeps,
	onSummary?: (summary: SyncSummary) => void,
): JobHandler {
	return async (job) => {
		const repo = getRepo(deps.db, job.target_id);
		if (!repo)
			throw new Error(
				`sync job ${job.id} targets unknown repo ${job.target_id}`,
			);
		onSummary?.(await syncRepo(deps, repo));
	};
}
