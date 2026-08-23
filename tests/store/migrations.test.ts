import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { statSync } from "node:fs";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { backupDatabase, openDatabase } from "../../src/store/db.ts";
import {
	applyMigrations,
	MIGRATIONS,
	migrateDatabase,
} from "../../src/store/migrations.ts";

let dir: string;
beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "notam-db-"));
});
afterEach(async () => {
	await rm(dir, { recursive: true, force: true });
});

function tableNames(db: Database): string[] {
	const rows = db
		.query<{ name: string }, []>(
			"SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
		)
		.all();
	return rows.map((r) => r.name).filter((n) => !n.startsWith("sqlite_"));
}

describe("openDatabase", () => {
	test("creates a missing nested parent directory at mode 0700", () => {
		const path = join(dir, "sub", "nested", "notam.db");
		openDatabase(path).close();
		const stat = statSync(join(dir, "sub", "nested"));
		expect(stat.mode & 0o777).toBe(0o700);
	});
});

describe("MIGRATIONS", () => {
	test("are numbered from 1 with no gaps and no duplicates", () => {
		expect(MIGRATIONS.map((m) => m.version)).toEqual(
			MIGRATIONS.map((_, i) => i + 1),
		);
	});
});

describe("applyMigrations", () => {
	test("creates the v1 tables on an empty database", () => {
		const db = new Database(":memory:");
		expect(applyMigrations(db)).toBe(MIGRATIONS.length);
		expect(tableNames(db)).toEqual([
			"entries",
			"hosts",
			"jobs",
			"promotions",
			"repos",
			"rules",
		]);
	});

	test("records the schema version in user_version", () => {
		const db = new Database(":memory:");
		applyMigrations(db);
		const row = db
			.query<{ user_version: number }, []>("PRAGMA user_version")
			.get();
		expect(row?.user_version).toBe(MIGRATIONS.length);
	});

	test("is idempotent — a second run applies nothing", () => {
		const db = new Database(":memory:");
		applyMigrations(db);
		expect(applyMigrations(db)).toBe(0);
	});

	test("enforces the unique constraint on (repo_id, kind, number)", () => {
		const db = openDatabase(":memory:");
		applyMigrations(db);
		db.query(
			"INSERT INTO hosts (id,label,api_base,graphql,token_env) VALUES ('github','GitHub','a','b','T')",
		).run();
		db.query(
			"INSERT INTO repos (id,host_id,name,path_globs,default_branch,window_days,created_at) VALUES ('r1','github','acme/mono','[]','main',180,'2026-01-01T00:00:00.000Z')",
		).run();
		const insert = db.query(
			"INSERT INTO entries (id,repo_id,kind,number,title,author,url,updated_at,payload_json,changed_paths,created_at) VALUES (?,'r1','pr',7,'t','a','u','2026-01-01T00:00:00.000Z','{}','[]','2026-01-01T00:00:00.000Z')",
		);
		insert.run("e1");
		expect(() => insert.run("e2")).toThrow();
	});

	test("cascades entry deletion when a repo is removed", () => {
		const db = openDatabase(":memory:");
		applyMigrations(db);
		db.query(
			"INSERT INTO hosts (id,label,api_base,graphql,token_env) VALUES ('github','GitHub','a','b','T')",
		).run();
		db.query(
			"INSERT INTO repos (id,host_id,name,path_globs,default_branch,window_days,created_at) VALUES ('r1','github','acme/mono','[]','main',180,'2026-01-01T00:00:00.000Z')",
		).run();
		db.query(
			"INSERT INTO entries (id,repo_id,kind,number,title,author,url,updated_at,payload_json,changed_paths,created_at) VALUES ('e1','r1','pr',7,'t','a','u','2026-01-01T00:00:00.000Z','{}','[]','2026-01-01T00:00:00.000Z')",
		).run();
		db.query("DELETE FROM repos WHERE id='r1'").run();
		const row = db
			.query<{ c: number }, []>("SELECT COUNT(*) AS c FROM entries")
			.get();
		expect(row?.c).toBe(0);
	});

	test("defaults an entry to unanalysed", () => {
		const db = openDatabase(":memory:");
		applyMigrations(db);
		db.query(
			"INSERT INTO hosts (id,label,api_base,graphql,token_env) VALUES ('github','GitHub','a','b','T')",
		).run();
		db.query(
			"INSERT INTO repos (id,host_id,name,path_globs,default_branch,window_days,created_at) VALUES ('r1','github','acme/mono','[]','main',180,'2026-01-01T00:00:00.000Z')",
		).run();
		db.query(
			"INSERT INTO entries (id,repo_id,kind,number,title,author,url,updated_at,payload_json,changed_paths,created_at) VALUES ('e1','r1','pr',7,'t','a','u','2026-01-01T00:00:00.000Z','{}','[]','2026-01-01T00:00:00.000Z')",
		).run();
		const row = db
			.query<
				{ analysis_state: string; kind: string; paths_truncated: number },
				[]
			>("SELECT analysis_state, kind, paths_truncated FROM entries")
			.get();
		expect(row?.analysis_state).toBe("unanalysed");
		expect(row?.kind).toBe("pr");
		expect(row?.paths_truncated).toBe(0);
	});
});

describe("migration 002", () => {
	function columns(db: Database, table: string): string[] {
		return db
			.query<{ name: string }, []>(`PRAGMA table_info(${table})`)
			.all()
			.map((row) => row.name);
	}

	test("creates promotions and rules", () => {
		const db = openDatabase(":memory:");
		applyMigrations(db);

		expect(columns(db, "promotions")).toEqual([
			"id",
			"repo_id",
			"branch",
			"pr_number",
			"pr_url",
			"state",
			"created_at",
			"last_checked_at",
		]);
		expect(columns(db, "rules")).toEqual([
			"id",
			"repo_id",
			"entry_id",
			"kind",
			"directive",
			"rationale",
			"scope_globs",
			"confidence",
			"source_comment_urls",
			"status",
			"promotion_id",
			"file_slug",
			"created_at",
			"status_changed_at",
		]);
		db.close();
	});

	test("is version 2 and leaves 001 untouched", () => {
		expect(MIGRATIONS.map((m) => m.version)).toEqual([1, 2]);
		expect(MIGRATIONS[0]?.name).toBe("hosts_repos_entries_jobs");
		expect(MIGRATIONS[1]?.name).toBe("rules_promotions");
	});

	test("applies on top of an existing 001-only database", () => {
		const db = openDatabase(":memory:");
		// Simulate a database that stopped at 001.
		const first = MIGRATIONS[0];
		if (!first) throw new Error("migration 001 is missing");
		db.exec(first.sql);
		db.exec("PRAGMA user_version = 1");

		expect(applyMigrations(db)).toBe(1);
		expect(
			db.query<{ user_version: number }, []>("PRAGMA user_version").get()
				?.user_version,
		).toBe(2);
		db.close();
	});

	test("cascades rules away with their repo and nulls promotion_id on delete", () => {
		const db = openDatabase(":memory:");
		applyMigrations(db);
		db.exec(`
			INSERT INTO hosts VALUES ('github', 'GitHub', 'https://api.github.com', 'https://api.github.com/graphql', 'T');
			INSERT INTO repos (id, host_id, name, created_at) VALUES ('r_1', 'github', 'acme/mono', '2026-08-23T00:00:00.000Z');
			INSERT INTO entries (id, repo_id, number, title, author, url, updated_at, payload_json, created_at)
				VALUES ('e_1', 'r_1', 1, 't', 'a', 'u', '2026-08-23T00:00:00.000Z', '{}', '2026-08-23T00:00:00.000Z');
			INSERT INTO promotions (id, repo_id, branch, created_at) VALUES ('pm_1', 'r_1', 'notam/rules-1', '2026-08-23T00:00:00.000Z');
			INSERT INTO rules (id, repo_id, entry_id, kind, directive, rationale, promotion_id, file_slug, created_at, status_changed_at)
				VALUES ('ru_1', 'r_1', 'e_1', 'do', 'd', 'r', 'pm_1', 'd', '2026-08-23T00:00:00.000Z', '2026-08-23T00:00:00.000Z');
		`);

		db.exec("DELETE FROM promotions WHERE id = 'pm_1'");
		expect(
			db
				.query<{ promotion_id: string | null }, []>(
					"SELECT promotion_id FROM rules WHERE id = 'ru_1'",
				)
				.get()?.promotion_id,
		).toBeNull();

		db.exec("DELETE FROM repos WHERE id = 'r_1'");
		expect(
			db.query<{ c: number }, []>("SELECT COUNT(*) AS c FROM rules").get()?.c,
		).toBe(0);
		db.close();
	});
});

describe("backupDatabase", () => {
	test("returns null when there is no database yet", async () => {
		expect(await backupDatabase(join(dir, "notam.db"))).toBeNull();
	});

	test("copies the file to a timestamped name", async () => {
		const path = join(dir, "notam.db");
		openDatabase(path).close();
		const backup = await backupDatabase(
			path,
			new Date("2026-08-23T09:15:00.000Z"),
		);
		expect(backup).toBe(join(dir, "notam.db.2026-08-23T09-15-00-000Z.bak"));
		expect(await Bun.file(backup as string).exists()).toBe(true);
	});
});

describe("migrateDatabase", () => {
	test("takes no backup on a first run, because there is nothing to lose", async () => {
		const path = join(dir, "notam.db");
		const { db, applied, backup } = await migrateDatabase(path);
		db.close();
		expect(applied).toBe(MIGRATIONS.length);
		expect(backup).toBeNull();
		expect((await readdir(dir)).filter((f) => f.endsWith(".bak"))).toHaveLength(
			0,
		);
	});

	test("takes no backup when the schema is already current", async () => {
		const path = join(dir, "notam.db");
		(await migrateDatabase(path)).db.close();
		const second = await migrateDatabase(path);
		second.db.close();
		expect(second.applied).toBe(0);
		expect(second.backup).toBeNull();
	});

	test("backs up before applying a migration to an existing database", async () => {
		const path = join(dir, "notam.db");
		const seed = openDatabase(path);
		seed.exec("CREATE TABLE placeholder (x INTEGER)");
		seed.close();
		const { db, applied, backup } = await migrateDatabase(
			path,
			new Date("2026-08-23T09:15:00.000Z"),
		);
		db.close();
		expect(applied).toBe(MIGRATIONS.length);
		expect(backup).toBe(join(dir, "notam.db.2026-08-23T09-15-00-000Z.bak"));
	});

	test("creates a missing nested directory at mode 0700", async () => {
		const path = join(dir, "sub", "nested", "notam.db");
		const { db } = await migrateDatabase(path);
		db.close();
		const stat = statSync(join(dir, "sub", "nested"));
		expect(stat.mode & 0o777).toBe(0o700);
	});
});
