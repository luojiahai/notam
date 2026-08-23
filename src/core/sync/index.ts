import type { Database } from "bun:sqlite";
import type { JobHandler } from "../../jobs/pool.ts";
import type { HostRow, RepoRow } from "../../shared/types.ts";
import { upsertEntry } from "../../store/entries.ts";
import { getHost } from "../../store/hosts.ts";
import { getRepo, setWatermark } from "../../store/repos.ts";
// GitHubError is a type/class import, not a network call: syncRepo still
// never calls fetch itself, which stays github/'s job alone. It is needed
// here to discriminate "this PR is gone" (404/410, a counted skip) from every
// other failure (still fatal) — see finding I5.
import { GitHubError } from "../github/client.ts";
import {
	type GitHubClient,
	type PRDetail,
	parseRepoName,
} from "../github/types.ts";
import { matchesGlobs } from "./globs.ts";
import { normalisePR } from "./normalise.ts";

export type SyncEvent =
	| { type: "page"; scanned: number }
	| { type: "stored"; number: number; created: boolean }
	| { type: "skipped"; number: number; reason: "globs" }
	| {
			type: "missing";
			number: number;
			reason: "not-found" | "malformed-timestamp";
	  };

export type SyncSummary = {
	repo: string;
	scanned: number;
	created: number;
	updated: number;
	skipped: number;
	truncated: number;
	/**
	 * PRs GitHub listed but could not be hydrated or dated: a 404/410 from
	 * fetchPRDetail (deleted or made inaccessible between the list call and the
	 * detail call) or a listing node with a timestamp that fails to parse.
	 * Counted separately from `skipped` — that's the user's own glob filter
	 * excluding a PR, a different fact from a PR having vanished. See finding I5.
	 */
	missing: number;
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
		missing: 0,
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
			let updatedAt: string;
			try {
				updatedAt = iso(node.updatedAt);
			} catch (error) {
				// A malformed timestamp on one listing node must not wedge the
				// whole repository (finding I5): skip just this node, counted, and
				// keep walking the rest of the page.
				if (error instanceof RangeError) {
					summary.missing++;
					deps.onProgress?.({
						type: "missing",
						number: node.number,
						reason: "malformed-timestamp",
					});
					continue;
				}
				throw error;
			}
			if (updatedAt < floor) {
				reachedFloor = true;
				break;
			}
			summary.scanned++;
			if (!highest || updatedAt > highest) highest = updatedAt;

			let detail: PRDetail;
			try {
				detail = await client.fetchPRDetail(ref, node.number);
			} catch (error) {
				// A PR deleted or made inaccessible between the list call and the
				// detail call is a counted skip, not a fatal error (finding I5) —
				// otherwise this one PR would wedge the repository's sync forever,
				// since the watermark never advances past a thrown job. Every other
				// status, and every non-GitHubError, still throws: a bad token must
				// not become a silent no-op.
				if (
					error instanceof GitHubError &&
					(error.status === 404 || error.status === 410)
				) {
					summary.missing++;
					deps.onProgress?.({
						type: "missing",
						number: node.number,
						reason: "not-found",
					});
					continue;
				}
				throw error;
			}
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

		if (reachedFloor) break;
		if (!page.hasNextPage) break;
		if (!page.endCursor) {
			// The client already treats this identical malformed shape as fatal on
			// the files side (github/client.ts). Silently breaking here would
			// commit `highest` — page 1's maximum — as the watermark, and every
			// PR the aborted pagination never reached would be skipped
			// *permanently* on every future run (finding I4). Throwing leaves the
			// watermark unmoved, exactly as the doc comment above promises.
			throw new GitHubError(
				`${repo.name}: pagination reported another page but returned no cursor`,
			);
		}
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
