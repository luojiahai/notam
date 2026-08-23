import type { Database } from "bun:sqlite";
import { beforeEach, describe, expect, test } from "bun:test";
import type {
	GitHubClient,
	PRDetail,
	PRPage,
	PRRef,
	RepoRef,
} from "../../../src/core/github/types.ts";
import { type SyncDeps, syncRepo } from "../../../src/core/sync/index.ts";
import type { RepoRow } from "../../../src/shared/types.ts";
import { openDatabase } from "../../../src/store/db.ts";
import { getEntryByNumber, listEntries } from "../../../src/store/entries.ts";
import { upsertHost } from "../../../src/store/hosts.ts";
import { applyMigrations } from "../../../src/store/migrations.ts";
import { getRepo, upsertRepo } from "../../../src/store/repos.ts";

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

	test("stops at the watermark on a second sync and re-fetches nothing older", async () => {
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
		expect(second.detailCalls).toEqual([4]);
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
});
