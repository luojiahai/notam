import type { Database } from "bun:sqlite";
import { beforeEach, describe, expect, test } from "bun:test";
import type { NormalisedEntry } from "../../src/shared/types.ts";
import { openDatabase } from "../../src/store/db.ts";
import {
	countEntries,
	getEntryByNumber,
	listEntries,
	upsertEntry,
} from "../../src/store/entries.ts";
import { upsertHost } from "../../src/store/hosts.ts";
import { applyMigrations } from "../../src/store/migrations.ts";
import { setWatermark, upsertRepo } from "../../src/store/repos.ts";

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
