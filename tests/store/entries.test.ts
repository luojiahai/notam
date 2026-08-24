import type { Database } from "bun:sqlite";
import { beforeEach, describe, expect, test } from "bun:test";
import type { NormalisedEntry } from "../../src/shared/types.ts";
import { openDatabase } from "../../src/store/db.ts";
import {
	countEntries,
	countEntriesByState,
	getEntryByNumber,
	listEntries,
	listEntriesByIds,
	listEntriesByState,
	requeueRunningEntries,
	revertAnalysisState,
	setAnalysisState,
	upsertEntry,
} from "../../src/store/entries.ts";
import { upsertHost } from "../../src/store/hosts.ts";
import { insertJob } from "../../src/store/jobs.ts";
import { applyMigrations } from "../../src/store/migrations.ts";
import { setWatermark, upsertRepo } from "../../src/store/repos.ts";
import { normalisedEntry, SEED_NOW, seedDatabase } from "../helpers/seed.ts";

const NOW = new Date("2026-08-23T09:00:00.000Z");

function entry(overrides: Partial<NormalisedEntry> = {}): NormalisedEntry {
	const number = overrides.number ?? 4821;
	return {
		number,
		title: "Fix rounding in payments",
		author: "dana",
		url: `https://github.com/acme/mono/pull/${number}`,
		merged_at: "2026-08-20T10:00:00.000Z",
		updated_at: "2026-08-21T10:00:00.000Z",
		changed_paths: ["services/payments/round.ts"],
		paths_truncated: false,
		payload: {
			kind: "pr",
			number,
			title: "Fix rounding in payments",
			body: "body",
			url: `https://github.com/acme/mono/pull/${number}`,
			author: "dana",
			labels: ["bug"],
			merged_at: "2026-08-20T10:00:00.000Z",
			updated_at: "2026-08-21T10:00:00.000Z",
			changed_paths: ["services/payments/round.ts"],
			paths_truncated: false,
			conversation_truncated: false,
			reviews: [],
			review_threads: [],
			comments: [],
		},
		...overrides,
	};
}

let db: Database;
let repoId: string;
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
	repoId = upsertRepo(
		db,
		"github",
		{
			host: "github",
			name: "acme/mono",
			path_globs: [],
			default_branch: "main",
			window_days: 180,
		},
		NOW,
	).id;
});

describe("upsertEntry", () => {
	test("inserts a new entry and reports it as created", () => {
		const result = upsertEntry(db, repoId, entry(), NOW);
		expect(result.created).toBe(true);
		expect(result.id).toStartWith("e_");
		expect(countEntries(db, repoId)).toBe(1);
	});

	test("round-trips the payload and changed paths through JSON", () => {
		upsertEntry(db, repoId, entry(), NOW);
		const row = getEntryByNumber(db, repoId, 4821);
		expect(row?.payload.labels).toEqual(["bug"]);
		expect(row?.payload.conversation_truncated).toBe(false);
		expect(row?.changed_paths).toEqual(["services/payments/round.ts"]);
		expect(row?.paths_truncated).toBe(false);
		expect(row?.kind).toBe("pr");
		expect(row?.analysis_state).toBe("unanalysed");
	});

	test("re-syncing refreshes metadata and reuses the same id", () => {
		const first = upsertEntry(db, repoId, entry(), NOW);
		const second = upsertEntry(
			db,
			repoId,
			entry({
				title: "Fix rounding in payments (v2)",
				updated_at: "2026-08-22T10:00:00.000Z",
			}),
			NOW,
		);
		expect(second.created).toBe(false);
		expect(second.id).toBe(first.id);
		expect(countEntries(db, repoId)).toBe(1);
		const row = getEntryByNumber(db, repoId, 4821);
		expect(row?.title).toBe("Fix rounding in payments (v2)");
		expect(row?.updated_at).toBe("2026-08-22T10:00:00.000Z");
	});

	test("re-syncing never resets analysis_state or its companions", () => {
		upsertEntry(db, repoId, entry(), NOW);
		db.query(
			"UPDATE entries SET analysis_state='analysed', analysed_at='2026-08-22T00:00:00.000Z', last_error='old' WHERE number=4821",
		).run();
		upsertEntry(db, repoId, entry({ title: "changed" }), NOW);
		const row = getEntryByNumber(db, repoId, 4821);
		expect(row?.analysis_state).toBe("analysed");
		expect(row?.analysed_at).toBe("2026-08-22T00:00:00.000Z");
		expect(row?.last_error).toBe("old");
		expect(row?.title).toBe("changed");
	});

	test("stores paths_truncated as a real boolean", () => {
		upsertEntry(db, repoId, entry({ paths_truncated: true }), NOW);
		expect(getEntryByNumber(db, repoId, 4821)?.paths_truncated).toBe(true);
	});

	test("round-trips a true conversation_truncated flag inside the payload", () => {
		const withTruncation = entry();
		upsertEntry(
			db,
			repoId,
			{
				...withTruncation,
				payload: { ...withTruncation.payload, conversation_truncated: true },
			},
			NOW,
		);
		expect(
			getEntryByNumber(db, repoId, 4821)?.payload.conversation_truncated,
		).toBe(true);
	});

	test("keeps entries from different repos separate", () => {
		const otherId = upsertRepo(
			db,
			"github",
			{
				host: "github",
				name: "acme/other",
				path_globs: [],
				default_branch: "main",
				window_days: 180,
			},
			NOW,
		).id;
		upsertEntry(db, repoId, entry(), NOW);
		upsertEntry(db, otherId, entry(), NOW);
		expect(countEntries(db, repoId)).toBe(1);
		expect(countEntries(db, otherId)).toBe(1);
	});

	test("lists entries newest-updated first", () => {
		upsertEntry(
			db,
			repoId,
			entry({ number: 1, updated_at: "2026-08-01T00:00:00.000Z" }),
			NOW,
		);
		upsertEntry(
			db,
			repoId,
			entry({ number: 2, updated_at: "2026-08-09T00:00:00.000Z" }),
			NOW,
		);
		expect(listEntries(db, repoId).map((e) => e.number)).toEqual([2, 1]);
	});
});

describe("setWatermark", () => {
	test("persists and survives a repo config re-upsert", () => {
		setWatermark(db, repoId, "2026-08-21T10:00:00.000Z");
		upsertRepo(
			db,
			"github",
			{
				host: "github",
				name: "acme/mono",
				path_globs: ["services/**"],
				default_branch: "main",
				window_days: 90,
			},
			NOW,
		);
		const row = db
			.query<{ sync_watermark: string; window_days: number }, [string]>(
				"SELECT sync_watermark, window_days FROM repos WHERE id = ?",
			)
			.get(repoId);
		expect(row?.sync_watermark).toBe("2026-08-21T10:00:00.000Z");
		expect(row?.window_days).toBe(90);
	});
});

describe("analysis state", () => {
	test("setAnalysisState writes the state and only the fields it is given", () => {
		const id = upsertEntry(db, repoId, entry(), NOW).id;

		expect(setAnalysisState(db, id, "queued", { error: null })).toBe(true);
		expect(getEntryByNumber(db, repoId, 4821)?.analysis_state).toBe("queued");

		setAnalysisState(db, id, "analysed", {
			analysedAt: "2026-08-24T00:00:00.000Z",
			error: null,
		});
		let row = getEntryByNumber(db, repoId, 4821);
		expect(row?.analysis_state).toBe("analysed");
		expect(row?.analysed_at).toBe("2026-08-24T00:00:00.000Z");

		// Re-queueing must not erase when it was last analysed: the UI shows it.
		setAnalysisState(db, id, "queued", { error: null });
		row = getEntryByNumber(db, repoId, 4821);
		expect(row?.analysed_at).toBe("2026-08-24T00:00:00.000Z");
	});

	test("setAnalysisState stores a failure message and clears it on the next run", () => {
		const id = upsertEntry(db, repoId, entry(), NOW).id;
		setAnalysisState(db, id, "failed", { error: "claude exited 1" });
		expect(getEntryByNumber(db, repoId, 4821)?.last_error).toBe(
			"claude exited 1",
		);
		setAnalysisState(db, id, "running", { error: null });
		expect(getEntryByNumber(db, repoId, 4821)?.last_error).toBeNull();
	});

	test("setAnalysisState reports false for an unknown id", () => {
		expect(setAnalysisState(db, "e_nope", "failed", { error: "x" })).toBe(
			false,
		);
	});

	test("listEntriesByState and countEntriesByState partition the repo", () => {
		const first = upsertEntry(db, repoId, entry({ number: 1 }), NOW).id;
		upsertEntry(db, repoId, entry({ number: 2 }), NOW);
		setAnalysisState(db, first, "failed", { error: "boom" });

		expect(
			listEntriesByState(db, repoId, "failed").map((e) => e.number),
		).toEqual([1]);
		expect(
			listEntriesByState(db, repoId, "unanalysed").map((e) => e.number),
		).toEqual([2]);
		expect(countEntriesByState(db, repoId)).toEqual({
			unanalysed: 1,
			queued: 0,
			running: 0,
			analysed: 0,
			failed: 1,
		});
	});
});

describe("listEntriesByIds", () => {
	test("returns only the ids asked for, and nothing for an empty list", () => {
		const { db, repo, entry } = seedDatabase();
		upsertEntry(db, repo.id, normalisedEntry({ number: 4822 }), SEED_NOW);
		expect(listEntriesByIds(db, [])).toEqual([]);
		const found = listEntriesByIds(db, [entry.id, "e_missing"]);
		expect(found.map((row) => row.id)).toEqual([entry.id]);
		expect(found[0]?.payload.number).toBe(4821);
		db.close();
	});
});

describe("requeueRunningEntries", () => {
	test("returns a running entry to queued when its analyse job is back in the queue", () => {
		const id = upsertEntry(db, repoId, entry(), NOW).id;
		setAnalysisState(db, id, "running", { error: null });
		insertJob(db, {
			id: "j_1",
			kind: "analyse",
			target_id: id,
			created_at: NOW.toISOString(),
		});

		expect(requeueRunningEntries(db)).toBe(1);
		expect(getEntryByNumber(db, repoId, 4821)?.analysis_state).toBe("queued");
	});

	test("leaves a running entry with nothing queued behind it alone", () => {
		const id = upsertEntry(db, repoId, entry(), NOW).id;
		setAnalysisState(db, id, "running", { error: null });

		expect(requeueRunningEntries(db)).toBe(0);
		expect(getEntryByNumber(db, repoId, 4821)?.analysis_state).toBe("running");
	});
});

describe("revertAnalysisState", () => {
	test("returns a never-analysed entry to unanalysed and clears its error", () => {
		const id = upsertEntry(db, repoId, entry(), NOW).id;
		setAnalysisState(db, id, "queued", { error: "stale" });

		expect(revertAnalysisState(db, id)).toBe(true);
		const row = getEntryByNumber(db, repoId, 4821);
		expect(row?.analysis_state).toBe("unanalysed");
		expect(row?.last_error).toBeNull();
	});

	test("returns a previously analysed entry to analysed, keeping when that was", () => {
		const id = upsertEntry(db, repoId, entry(), NOW).id;
		setAnalysisState(db, id, "analysed", {
			analysedAt: "2026-08-24T00:00:00.000Z",
			error: null,
		});
		setAnalysisState(db, id, "running", { error: null });

		expect(revertAnalysisState(db, id)).toBe(true);
		const row = getEntryByNumber(db, repoId, 4821);
		expect(row?.analysis_state).toBe("analysed");
		expect(row?.analysed_at).toBe("2026-08-24T00:00:00.000Z");
	});

	test("refuses an entry that is not queued or running", () => {
		const id = upsertEntry(db, repoId, entry(), NOW).id;
		setAnalysisState(db, id, "analysed", {
			analysedAt: "2026-08-24T00:00:00.000Z",
			error: null,
		});

		// The race this guards: a stop press landing just after the run it
		// meant to stop has already written its result.
		expect(revertAnalysisState(db, id)).toBe(false);
		expect(getEntryByNumber(db, repoId, 4821)?.analysis_state).toBe("analysed");
	});
});
