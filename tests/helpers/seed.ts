import type { Database } from "bun:sqlite";
import type {
	EntryRow,
	NormalisedEntry,
	RepoRow,
} from "../../src/shared/types.ts";
import { openDatabase } from "../../src/store/db.ts";
import { getEntryByNumber, upsertEntry } from "../../src/store/entries.ts";
import { upsertHost } from "../../src/store/hosts.ts";
import { applyMigrations } from "../../src/store/migrations.ts";
import { upsertRepo } from "../../src/store/repos.ts";

export const SEED_NOW = new Date("2026-08-23T09:00:00.000Z");

/** A normalised entry with a real review conversation, so prompt rendering has something to render. */
export function normalisedEntry(
	overrides: Partial<NormalisedEntry> = {},
): NormalisedEntry {
	const number = overrides.number ?? 4821;
	const url = `https://github.com/acme/mono/pull/${number}`;
	return {
		number,
		title: "Fix rounding in payments",
		author: "dana",
		url,
		merged_at: "2026-08-20T10:00:00.000Z",
		updated_at: "2026-08-21T10:00:00.000Z",
		changed_paths: ["services/payments/round.ts"],
		paths_truncated: false,
		payload: {
			kind: "pr",
			number,
			title: "Fix rounding in payments",
			body: "Rounds half-up instead of half-even.",
			url,
			author: "dana",
			labels: ["bug"],
			merged_at: "2026-08-20T10:00:00.000Z",
			updated_at: "2026-08-21T10:00:00.000Z",
			changed_paths: ["services/payments/round.ts"],
			paths_truncated: false,
			conversation_truncated: false,
			reviews: [
				{
					author: "sam",
					state: "CHANGES_REQUESTED",
					body: "Needs a regression test.",
					url: `${url}#pullrequestreview-1`,
					submitted_at: "2026-08-20T09:00:00.000Z",
				},
			],
			review_threads: [
				{
					path: "services/payments/round.ts",
					line: 42,
					resolved: true,
					comments: [
						{
							author: "sam",
							body: "Every payment fix here has shipped with a test reproducing the bug. Please add one.",
							url: `${url}#discussion_r1`,
							created_at: "2026-08-20T09:00:00.000Z",
						},
					],
				},
			],
			comments: [
				{
					author: "dana",
					body: "Added the test.",
					url: `${url}#issuecomment-1`,
					created_at: "2026-08-20T09:30:00.000Z",
				},
			],
		},
		...overrides,
	};
}

export type Seeded = {
	db: Database;
	hostId: string;
	repo: RepoRow;
	entry: EntryRow;
};

/** An in-memory database at the current schema, holding one host, one repo, one entry. */
export function seedDatabase(now: Date = SEED_NOW): Seeded {
	const db = openDatabase(":memory:");
	applyMigrations(db);
	const host = upsertHost(db, {
		id: "github",
		label: "GitHub",
		api_base: "https://api.github.com",
		graphql: "https://api.github.com/graphql",
		token_env: "NOTAM_TEST_TOKEN",
	});
	const repo = upsertRepo(
		db,
		host.id,
		{
			host: host.id,
			name: "acme/mono",
			path_globs: ["services/payments/**"],
			default_branch: "main",
			window_days: 180,
		},
		now,
	);
	const normalised = normalisedEntry();
	upsertEntry(db, repo.id, normalised, now);
	const entry = getEntryByNumber(db, repo.id, normalised.number);
	if (!entry) throw new Error("seed entry vanished");
	return { db, hostId: host.id, repo, entry };
}
