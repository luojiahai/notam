import type { Database } from "bun:sqlite";
import { beforeEach, describe, expect, test } from "bun:test";
import { GitHubError } from "../../../src/core/github/client.ts";
import type {
	GitHubClient,
	PRDetail,
	PRPage,
	PRRef,
	RepoRef,
} from "../../../src/core/github/types.ts";
import {
	createSyncHandler,
	type SyncDeps,
	syncRepo,
} from "../../../src/core/sync/index.ts";
import type { JobRow, RepoRow } from "../../../src/shared/types.ts";
import { openDatabase } from "../../../src/store/db.ts";
import { getEntryByNumber, listEntries } from "../../../src/store/entries.ts";
import { upsertHost } from "../../../src/store/hosts.ts";
import { applyMigrations } from "../../../src/store/migrations.ts";
import { getRepo, upsertRepo } from "../../../src/store/repos.ts";

/** A signal that never aborts: these tests exercise the handler, not cancellation. */
const NEVER = new AbortController().signal;

const NOW = new Date("2026-08-23T09:00:00.000Z");

/** A PR fixture builder: number, when it was updated, and what it touched. */
function pr(
	number: number,
	updatedAt: string,
	paths: string[],
	pathsTruncated = false,
): { ref: PRRef; detail: PRDetail } {
	return {
		ref: { number, updatedAt, mergedAt: updatedAt },
		detail: {
			pullRequest: {
				number,
				title: `PR ${number}`,
				body: "body",
				url: `https://github.com/acme/mono/pull/${number}`,
				updatedAt,
				mergedAt: updatedAt,
				author: { login: "dana" },
				labels: { nodes: [] },
				reviews: { nodes: [] },
				reviewThreads: { nodes: [] },
				comments: { nodes: [] },
			},
			changedPaths: paths,
			pathsTruncated,
		},
	};
}

/** A fake client over a fixed list of PRs, paginated at `pageSize`. */
function fakeClient(
	prs: ReturnType<typeof pr>[],
	options: { pageSize?: number; failOn?: number } = {},
): GitHubClient & { detailCalls: number[] } {
	const pageSize = options.pageSize ?? 50;
	const detailCalls: number[] = [];
	return {
		detailCalls,
		async listMergedPRs(
			_repo: RepoRef,
			opts: { cursor?: string; pageSize?: number },
		): Promise<PRPage> {
			const start = opts.cursor ? Number(opts.cursor) : 0;
			const size = opts.pageSize ?? pageSize;
			const slice = prs.slice(start, start + size);
			const next = start + size;
			return {
				nodes: slice.map((p) => p.ref),
				endCursor: String(next),
				hasNextPage: next < prs.length,
			};
		},
		async fetchPRDetail(_repo: RepoRef, number: number): Promise<PRDetail> {
			detailCalls.push(number);
			if (options.failOn === number)
				throw new Error(`GitHub exploded on #${number}`);
			const found = prs.find((p) => p.ref.number === number);
			if (!found) throw new Error(`no fixture for #${number}`);
			return found.detail;
		},
	};
}

let db: Database;
function makeRepo(
	overrides: { path_globs?: string[]; window_days?: number } = {},
): RepoRow {
	return upsertRepo(
		db,
		"github",
		{
			host: "github",
			name: "acme/mono",
			path_globs: overrides.path_globs ?? [],
			default_branch: "main",
			window_days: overrides.window_days ?? 180,
		},
		NOW,
	);
}

function deps(client: GitHubClient, extra: Partial<SyncDeps> = {}): SyncDeps {
	return { db, clientFor: () => client, now: () => NOW, ...extra };
}

/** A `sync` job fixture: only `target_id` matters to `createSyncHandler`. */
function makeJob(targetId: string): JobRow {
	return {
		id: "job-1",
		kind: "sync",
		target_id: targetId,
		state: "running",
		attempts: 1,
		error: null,
		created_at: NOW.toISOString(),
		started_at: NOW.toISOString(),
		finished_at: null,
	};
}

beforeEach(() => {
	db = openDatabase(":memory:");
	applyMigrations(db);
	upsertHost(db, {
		id: "github",
		label: "GitHub",
		api_base: "https://api.github.com",
		graphql: "https://api.github.com/graphql",
		token_env: "T",
	});
});

describe("syncRepo", () => {
	test("stores every merged PR when no globs narrow the repository", async () => {
		const client = fakeClient([
			pr(3, "2026-08-20T00:00:00Z", ["web/app.tsx"]),
			pr(2, "2026-08-19T00:00:00Z", ["docs/x.md"]),
		]);
		const summary = await syncRepo(deps(client), makeRepo());
		expect(summary.created).toBe(2);
		expect(summary.skipped).toBe(0);
		expect(listEntries(db, makeRepo().id)).toHaveLength(2);
	});

	test("skips a PR whose changed paths miss every glob, without storing it", async () => {
		const client = fakeClient([
			pr(3, "2026-08-20T00:00:00Z", ["services/payments/round.ts"]),
			pr(2, "2026-08-19T00:00:00Z", ["services/shipping/rate.ts"]),
		]);
		const repo = makeRepo({ path_globs: ["services/payments/**"] });
		const summary = await syncRepo(deps(client), repo);
		expect(summary.created).toBe(1);
		expect(summary.skipped).toBe(1);
		expect(getEntryByNumber(db, repo.id, 3)).not.toBeNull();
		expect(getEntryByNumber(db, repo.id, 2)).toBeNull();
	});

	test("stops paginating once PRs fall outside the sync window", async () => {
		const client = fakeClient(
			[
				pr(3, "2026-08-20T00:00:00Z", ["a.ts"]),
				pr(2, "2026-05-01T00:00:00Z", ["b.ts"]),
				pr(1, "2026-01-01T00:00:00Z", ["c.ts"]),
			],
			{ pageSize: 1 },
		);
		const summary = await syncRepo(
			deps(client, { pageSize: 1 }),
			makeRepo({ window_days: 30 }),
		);
		expect(summary.created).toBe(1);
		expect(client.detailCalls).toEqual([3]);
	});

	test("re-scans PRs sharing the watermark's exact instant, but stops before anything strictly older", async () => {
		const prs = [
			pr(3, "2026-08-20T00:00:00Z", ["a.ts"]),
			pr(2, "2026-08-10T00:00:00Z", ["b.ts"]),
		];
		const repo = makeRepo();
		await syncRepo(deps(fakeClient(prs)), repo);

		const second = fakeClient([
			pr(4, "2026-08-22T00:00:00Z", ["d.ts"]),
			...prs,
		]);
		const refreshed = getRepo(db, repo.id);
		if (!refreshed) throw new Error("repo vanished");
		const summary = await syncRepo(deps(second), refreshed);
		expect(summary.created).toBe(1);
		expect(summary.updated).toBe(1);
		// #4 is strictly newer than the watermark and is fetched normally. #3's
		// updated_at *is* the watermark instant (second precision, not unique
		// across PRs) and must be re-fetched too, or a PR that shares that exact
		// instant with the one that set the watermark would be dropped forever.
		// #2 is strictly older than the watermark and must not be re-fetched —
		// that's what proves the re-scan stays bounded rather than walking back
		// into the whole window.
		expect(second.detailCalls).toEqual([4, 3]);
	});

	test("advances the watermark to the newest updated_at seen", async () => {
		const repo = makeRepo();
		const summary = await syncRepo(
			deps(
				fakeClient([
					pr(3, "2026-08-20T00:00:00Z", ["a.ts"]),
					pr(2, "2026-08-10T00:00:00Z", ["b.ts"]),
				]),
			),
			repo,
		);
		expect(summary.watermark).toBe("2026-08-20T00:00:00.000Z");
		expect(getRepo(db, repo.id)?.sync_watermark).toBe(
			"2026-08-20T00:00:00.000Z",
		);
	});

	test("advances the watermark even when every PR was filtered out", async () => {
		const repo = makeRepo({ path_globs: ["libs/**"] });
		const summary = await syncRepo(
			deps(fakeClient([pr(3, "2026-08-20T00:00:00Z", ["web/app.tsx"])])),
			repo,
		);
		expect(summary.skipped).toBe(1);
		expect(getRepo(db, repo.id)?.sync_watermark).toBe(
			"2026-08-20T00:00:00.000Z",
		);
	});

	test("leaves the watermark untouched when the run fails, so nothing is skipped next time", async () => {
		const repo = makeRepo();
		const client = fakeClient(
			[
				pr(3, "2026-08-20T00:00:00Z", ["a.ts"]),
				pr(2, "2026-08-19T00:00:00Z", ["b.ts"]),
			],
			{ pageSize: 1, failOn: 2 },
		);
		await expect(syncRepo(deps(client, { pageSize: 1 }), repo)).rejects.toThrow(
			"GitHub exploded on #2",
		);
		await Bun.sleep(0);
		expect(getRepo(db, repo.id)?.sync_watermark).toBeNull();
	});

	test("keeps entries committed before a mid-run failure", async () => {
		const repo = makeRepo();
		const client = fakeClient(
			[
				pr(3, "2026-08-20T00:00:00Z", ["a.ts"]),
				pr(2, "2026-08-19T00:00:00Z", ["b.ts"]),
			],
			{ pageSize: 1, failOn: 2 },
		);
		try {
			await syncRepo(deps(client, { pageSize: 1 }), repo);
		} catch {
			// expected
		}
		expect(getEntryByNumber(db, repo.id, 3)).not.toBeNull();
	});

	test("refreshes an existing entry without resetting its analysis state", async () => {
		const repo = makeRepo();
		await syncRepo(
			deps(fakeClient([pr(3, "2026-08-20T00:00:00Z", ["a.ts"])])),
			repo,
		);
		db.query(
			"UPDATE entries SET analysis_state='analysed', analysed_at='2026-08-21T00:00:00.000Z'",
		).run();

		const updated = pr(3, "2026-08-22T00:00:00Z", ["a.ts", "b.ts"]);
		updated.detail.pullRequest.title = "PR 3 retitled";
		const summary = await syncRepo(deps(fakeClient([updated])), makeRepo());
		expect(summary.created).toBe(0);
		expect(summary.updated).toBe(1);
		const row = getEntryByNumber(db, repo.id, 3);
		expect(row?.title).toBe("PR 3 retitled");
		expect(row?.changed_paths).toEqual(["a.ts", "b.ts"]);
		expect(row?.analysis_state).toBe("analysed");
	});

	test("counts and records entries whose file list was truncated", async () => {
		const repo = makeRepo();
		const summary = await syncRepo(
			deps(fakeClient([pr(3, "2026-08-20T00:00:00Z", ["a.ts"], true)])),
			repo,
		);
		expect(summary.truncated).toBe(1);
		expect(getEntryByNumber(db, repo.id, 3)?.paths_truncated).toBe(true);
	});

	test("walks every page until the window is exhausted", async () => {
		const prs = Array.from({ length: 7 }, (_, i) =>
			pr(100 - i, `2026-08-${String(20 - i).padStart(2, "0")}T00:00:00Z`, [
				"a.ts",
			]),
		);
		const client = fakeClient(prs, { pageSize: 2 });
		const summary = await syncRepo(deps(client, { pageSize: 2 }), makeRepo());
		expect(summary.created).toBe(7);
		expect(client.detailCalls).toHaveLength(7);
	});

	test("reports progress events as it goes", async () => {
		const events: string[] = [];
		const client = fakeClient([
			pr(3, "2026-08-20T00:00:00Z", ["a.ts"]),
			pr(2, "2026-08-19T00:00:00Z", ["z.ts"]),
		]);
		await syncRepo(
			deps(client, { onProgress: (event) => events.push(event.type) }),
			makeRepo({ path_globs: ["a.ts"] }),
		);
		expect(events).toContain("page");
		expect(events).toContain("stored");
		expect(events).toContain("skipped");
	});

	test("throws when the repo references a host that isn't in the store", async () => {
		// Built by hand rather than via upsertRepo: repos.host_id has a foreign
		// key to hosts(id), so the store itself can never hold this row. This
		// exercises syncRepo's own guard against a RepoRow it's handed directly.
		const orphan: RepoRow = {
			id: "r-orphan",
			host_id: "no-such-host",
			name: "acme/mono",
			path_globs: [],
			default_branch: "main",
			window_days: 180,
			prompt_template: null,
			sync_watermark: null,
			created_at: NOW.toISOString(),
		};
		await expect(syncRepo(deps(fakeClient([])), orphan)).rejects.toThrow(
			/unknown host/,
		);
	});
});

describe("createSyncHandler", () => {
	test("rejects when the job's target_id names an unknown repo, so the pool retries", async () => {
		const handler = createSyncHandler(deps(fakeClient([])));
		await expect(handler(makeJob("no-such-repo"), NEVER)).rejects.toThrow(
			/unknown repo/,
		);
	});

	test("calls onSummary with the repo's sync summary for a real repo id", async () => {
		const repo = makeRepo();
		const client = fakeClient([pr(3, "2026-08-20T00:00:00Z", ["a.ts"])]);
		const summaries: Array<{ repo: string; created: number }> = [];
		const handler = createSyncHandler(deps(client), (summary) => {
			summaries.push(summary);
		});
		await handler(makeJob(repo.id), NEVER);
		expect(summaries).toHaveLength(1);
		expect(summaries[0]?.repo).toBe("acme/mono");
		expect(summaries[0]?.created).toBe(1);
	});
});

describe("syncRepo — malformed pagination (I4)", () => {
	test("rejects when a page reports hasNextPage with no cursor, and leaves the watermark unmoved", async () => {
		const repo = makeRepo();
		const fixture = pr(3, "2026-08-20T00:00:00Z", ["a.ts"]);
		const client: GitHubClient = {
			async listMergedPRs(): Promise<PRPage> {
				return { nodes: [fixture.ref], endCursor: null, hasNextPage: true };
			},
			async fetchPRDetail(_repo: RepoRef, number: number): Promise<PRDetail> {
				if (number !== fixture.ref.number)
					throw new Error(`unexpected fetchPRDetail(${number})`);
				return fixture.detail;
			},
		};

		await expect(syncRepo(deps(client), repo)).rejects.toThrow(GitHubError);
		// The important assertion: an aborted, malformed page must not commit
		// page 1's maximum as the watermark — that would permanently skip every
		// PR the pagination never reached.
		expect(getRepo(db, repo.id)?.sync_watermark).toBeNull();
	});
});

describe("syncRepo — missing PRs (I5)", () => {
	test("a 404 from fetchPRDetail counts as missing, completes the run, and advances the watermark past it", async () => {
		const repo = makeRepo();
		const client: GitHubClient = {
			async listMergedPRs(): Promise<PRPage> {
				return {
					nodes: [
						{
							number: 5,
							updatedAt: "2026-08-20T00:00:00Z",
							mergedAt: "2026-08-20T00:00:00Z",
						},
					],
					endCursor: null,
					hasNextPage: false,
				};
			},
			async fetchPRDetail(): Promise<PRDetail> {
				throw new GitHubError("pull request not found", 404);
			},
		};

		const summary = await syncRepo(deps(client), repo);
		expect(summary.missing).toBe(1);
		expect(summary.created).toBe(0);
		expect(summary.updated).toBe(0);
		// The whole point: the repo unwedges. A wedged repo would leave this null.
		expect(summary.watermark).toBe("2026-08-20T00:00:00.000Z");
		expect(getRepo(db, repo.id)?.sync_watermark).toBe(
			"2026-08-20T00:00:00.000Z",
		);
	});

	test("a 410 from fetchPRDetail counts as missing too", async () => {
		const repo = makeRepo();
		const client: GitHubClient = {
			async listMergedPRs(): Promise<PRPage> {
				return {
					nodes: [
						{
							number: 5,
							updatedAt: "2026-08-20T00:00:00Z",
							mergedAt: "2026-08-20T00:00:00Z",
						},
					],
					endCursor: null,
					hasNextPage: false,
				};
			},
			async fetchPRDetail(): Promise<PRDetail> {
				throw new GitHubError("gone", 410);
			},
		};

		const summary = await syncRepo(deps(client), repo);
		expect(summary.missing).toBe(1);
	});

	test("a 500 from fetchPRDetail still throws rather than being swallowed as missing", async () => {
		const repo = makeRepo();
		const client: GitHubClient = {
			async listMergedPRs(): Promise<PRPage> {
				return {
					nodes: [
						{
							number: 5,
							updatedAt: "2026-08-20T00:00:00Z",
							mergedAt: "2026-08-20T00:00:00Z",
						},
					],
					endCursor: null,
					hasNextPage: false,
				};
			},
			async fetchPRDetail(): Promise<PRDetail> {
				throw new GitHubError("server exploded", 500);
			},
		};

		await expect(syncRepo(deps(client), repo)).rejects.toThrow(GitHubError);
		expect(getRepo(db, repo.id)?.sync_watermark).toBeNull();
	});

	test("a non-GitHubError from fetchPRDetail still throws rather than being swallowed as missing", async () => {
		const repo = makeRepo();
		const client: GitHubClient = {
			async listMergedPRs(): Promise<PRPage> {
				return {
					nodes: [
						{
							number: 5,
							updatedAt: "2026-08-20T00:00:00Z",
							mergedAt: "2026-08-20T00:00:00Z",
						},
					],
					endCursor: null,
					hasNextPage: false,
				};
			},
			async fetchPRDetail(): Promise<PRDetail> {
				throw new Error("a plain network hiccup");
			},
		};

		await expect(syncRepo(deps(client), repo)).rejects.toThrow(
			"a plain network hiccup",
		);
	});

	test("a malformed listing timestamp skips just that node, counted, while the rest of the page still syncs", async () => {
		const repo = makeRepo();
		const good = pr(3, "2026-08-20T00:00:00Z", ["a.ts"]);
		const client: GitHubClient = {
			async listMergedPRs(): Promise<PRPage> {
				return {
					nodes: [
						{ number: 99, updatedAt: "not-a-real-timestamp", mergedAt: null },
						good.ref,
					],
					endCursor: null,
					hasNextPage: false,
				};
			},
			async fetchPRDetail(_repo: RepoRef, number: number): Promise<PRDetail> {
				if (number !== good.ref.number)
					throw new Error(`unexpected fetchPRDetail(${number})`);
				return good.detail;
			},
		};

		const summary = await syncRepo(deps(client), repo);
		expect(summary.missing).toBe(1);
		expect(summary.scanned).toBe(1);
		expect(summary.created).toBe(1);
		expect(getEntryByNumber(db, repo.id, good.ref.number)).not.toBeNull();
	});
});

describe("cancellation", () => {
	test("stops fetching the moment the signal aborts", async () => {
		const repo = makeRepo();
		const prs = [
			pr(5, "2026-08-20T00:00:05Z", ["a.ts"]),
			pr(4, "2026-08-20T00:00:04Z", ["b.ts"]),
			pr(3, "2026-08-20T00:00:03Z", ["c.ts"]),
			pr(2, "2026-08-20T00:00:02Z", ["d.ts"]),
		];
		const client = fakeClient(prs);
		const controller = new AbortController();
		// Abort once the second PR has been hydrated, mid-page.
		const gated: GitHubClient = {
			...client,
			async fetchPRDetail(ref, number, options) {
				const detail = await client.fetchPRDetail(ref, number, options);
				if (client.detailCalls.length === 2) controller.abort();
				return detail;
			},
		};

		await expect(
			syncRepo(deps(gated, { signal: controller.signal }), repo),
		).rejects.toThrow();
		expect(client.detailCalls).toEqual([5, 4]);
	});

	test("keeps the entries it already stored", async () => {
		const repo = makeRepo();
		const client = fakeClient([
			pr(5, "2026-08-20T00:00:05Z", ["a.ts"]),
			pr(4, "2026-08-20T00:00:04Z", ["b.ts"]),
			pr(3, "2026-08-20T00:00:03Z", ["c.ts"]),
		]);
		const controller = new AbortController();
		const gated: GitHubClient = {
			...client,
			async fetchPRDetail(ref, number, options) {
				const detail = await client.fetchPRDetail(ref, number, options);
				if (client.detailCalls.length === 2) controller.abort();
				return detail;
			},
		};

		await expect(
			syncRepo(deps(gated, { signal: controller.signal }), repo),
		).rejects.toThrow();
		expect(
			listEntries(db, repo.id)
				.map((entry) => entry.number)
				.sort(),
		).toEqual([4, 5]);
	});

	test("leaves the watermark unmoved, so the next run re-covers the ground", async () => {
		const repo = makeRepo();
		const client = fakeClient([
			pr(5, "2026-08-20T00:00:05Z", ["a.ts"]),
			pr(4, "2026-08-20T00:00:04Z", ["b.ts"]),
		]);
		const controller = new AbortController();
		const gated: GitHubClient = {
			...client,
			async fetchPRDetail(ref, number, options) {
				const detail = await client.fetchPRDetail(ref, number, options);
				controller.abort();
				return detail;
			},
		};

		await expect(
			syncRepo(deps(gated, { signal: controller.signal }), repo),
		).rejects.toThrow();
		expect(getRepo(db, repo.id)?.sync_watermark).toBeNull();
	});

	test("re-running after a cancel picks up where it stopped and finishes", async () => {
		const repo = makeRepo();
		const prs = [
			pr(5, "2026-08-20T00:00:05Z", ["a.ts"]),
			pr(4, "2026-08-20T00:00:04Z", ["b.ts"]),
			pr(3, "2026-08-20T00:00:03Z", ["c.ts"]),
		];
		const first = fakeClient(prs);
		const controller = new AbortController();
		const gated: GitHubClient = {
			...first,
			async fetchPRDetail(ref, number, options) {
				const detail = await first.fetchPRDetail(ref, number, options);
				controller.abort();
				return detail;
			},
		};
		await expect(
			syncRepo(deps(gated, { signal: controller.signal }), repo),
		).rejects.toThrow();

		const summary = await syncRepo(deps(fakeClient(prs)), repo);
		expect(summary.scanned).toBe(3);
		expect(listEntries(db, repo.id)).toHaveLength(3);
		expect(getRepo(db, repo.id)?.sync_watermark).toBe(
			"2026-08-20T00:00:05.000Z",
		);
	});

	test("refuses to start at all when the signal is already aborted", async () => {
		const repo = makeRepo();
		const client = fakeClient([pr(5, "2026-08-20T00:00:05Z", ["a.ts"])]);
		const controller = new AbortController();
		controller.abort();
		await expect(
			syncRepo(deps(client, { signal: controller.signal }), repo),
		).rejects.toThrow();
		expect(client.detailCalls).toEqual([]);
	});

	test("hands the signal to the client, so an in-flight request is abortable", async () => {
		const repo = makeRepo();
		const client = fakeClient([pr(5, "2026-08-20T00:00:05Z", ["a.ts"])]);
		const controller = new AbortController();
		const seen: (AbortSignal | undefined)[] = [];
		const spying: GitHubClient = {
			listMergedPRs: (ref, options) => {
				seen.push(options.signal);
				return client.listMergedPRs(ref, options);
			},
			fetchPRDetail: (ref, number, options) => {
				seen.push(options?.signal);
				return client.fetchPRDetail(ref, number, options);
			},
		};
		await syncRepo(deps(spying, { signal: controller.signal }), repo);
		expect(seen).toEqual([controller.signal, controller.signal]);
	});

	test("createSyncHandler threads the pool's signal into the sync", async () => {
		const repo = makeRepo();
		const client = fakeClient([pr(5, "2026-08-20T00:00:05Z", ["a.ts"])]);
		const controller = new AbortController();
		controller.abort();
		const handler = createSyncHandler(deps(client));
		await expect(
			handler(makeJob(repo.id), controller.signal),
		).rejects.toThrow();
		expect(client.detailCalls).toEqual([]);
	});
});

describe("createSyncHandler without a summary callback", () => {
	test("still runs the sync", async () => {
		const repo = makeRepo();
		const client = fakeClient([pr(7, "2026-08-20T00:00:00Z", ["a.ts"])]);
		const handler = createSyncHandler(deps(client));
		await handler(makeJob(repo.id), NEVER);
		expect(listEntries(db, repo.id)).toHaveLength(1);
	});
});
