import type { Database } from "bun:sqlite";
import { beforeEach, describe, expect, test } from "bun:test";
import type { RepoRow, RuleRow } from "../../src/shared/types.ts";
import { countEntries } from "../../src/store/entries.ts";
import {
	archiveHost,
	getHost,
	listArchivedHosts,
	listHosts,
	purgeHost,
	renameHost,
	restoreHost,
} from "../../src/store/hosts.ts";
import {
	archiveRepo,
	getRepo,
	listArchivedRepos,
	listRepos,
	purgeRepo,
	renameRepo,
	restoreRepo,
	setWatermark,
} from "../../src/store/repos.ts";
import { insertRules, listRules } from "../../src/store/rules.ts";
import { seedDatabase } from "../helpers/seed.ts";

const NOW = new Date("2026-08-23T09:00:00.000Z");
const LATER = new Date("2026-09-01T12:00:00.000Z");

describe("repo lifecycle", () => {
	let db: Database;
	let repo: RepoRow;
	let rules: RuleRow[];

	beforeEach(() => {
		const seeded = seedDatabase();
		db = seeded.db;
		repo = seeded.repo;
		rules = insertRules(
			db,
			repo.id,
			seeded.entry.id,
			[
				{
					type: "testing",
					directive: "Add a regression test with every payment fix",
					rationale: "Every payment fix here has shipped with one.",
					scope_globs: ["services/payments/**"],
					confidence: 0.9,
					source_comment_urls: [],
					file_slug: "add-a-regression-test",
				},
			],
			NOW,
		);
	});

	test("archiving hides the repo but keeps its entries and rules", () => {
		archiveRepo(db, repo.id, LATER);

		expect(listRepos(db)).toHaveLength(0);
		expect(listArchivedRepos(db).map((r) => r.id)).toEqual([repo.id]);
		expect(getRepo(db, repo.id)?.archived_at).toBe(LATER.toISOString());
		expect(countEntries(db, repo.id)).toBe(1);
		expect(listRules(db, repo.id)).toHaveLength(1);
	});

	test("restoring returns the repo to the active list", () => {
		archiveRepo(db, repo.id, LATER);
		restoreRepo(db, repo.id);

		expect(listRepos(db).map((r) => r.id)).toEqual([repo.id]);
		expect(listArchivedRepos(db)).toHaveLength(0);
		expect(getRepo(db, repo.id)?.archived_at).toBeNull();
	});

	test("purging deletes the repo and cascades to its entries and rules", () => {
		purgeRepo(db, repo.id);

		expect(getRepo(db, repo.id)).toBeNull();
		expect(countEntries(db, repo.id)).toBe(0);
		expect(
			db
				.query<{ n: number }, [string]>(
					"SELECT COUNT(*) AS n FROM rules WHERE id = ?",
				)
				.get(rules[0]?.id ?? "")?.n,
		).toBe(0);
	});

	test("renaming keeps the row, its watermark, and its rules", () => {
		setWatermark(db, repo.id, "2026-08-21T10:00:00.000Z");
		renameRepo(db, repo.id, "acme/monorepo");

		const renamed = getRepo(db, repo.id);
		expect(renamed?.name).toBe("acme/monorepo");
		expect(renamed?.sync_watermark).toBe("2026-08-21T10:00:00.000Z");
		expect(listRules(db, repo.id)).toHaveLength(1);
	});
});

describe("host lifecycle", () => {
	let db: Database;
	let repo: RepoRow;

	beforeEach(() => {
		const seeded = seedDatabase();
		db = seeded.db;
		repo = seeded.repo;
	});

	test("archiving a host hides it without touching its repos", () => {
		archiveHost(db, "github", LATER);

		expect(listHosts(db)).toHaveLength(0);
		expect(listArchivedHosts(db).map((h) => h.id)).toEqual(["github"]);
		expect(getRepo(db, repo.id)?.id).toBe(repo.id);
	});

	test("restoring a host returns it to the active list", () => {
		archiveHost(db, "github", LATER);
		restoreHost(db, "github");

		expect(listHosts(db).map((h) => h.id)).toEqual(["github"]);
		expect(getHost(db, "github")?.archived_at).toBeNull();
	});

	test("renaming a host carries its repos across without new repo ids", () => {
		renameHost(db, "github", "gh");

		expect(getHost(db, "github")).toBeNull();
		expect(getHost(db, "gh")?.label).toBe("GitHub");
		const moved = getRepo(db, repo.id);
		expect(moved?.id).toBe(repo.id);
		expect(moved?.host_id).toBe("gh");
	});

	test("purging a host cascades to its repos", () => {
		purgeHost(db, "github");

		expect(getHost(db, "github")).toBeNull();
		expect(getRepo(db, repo.id)).toBeNull();
	});
});
