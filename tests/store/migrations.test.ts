import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
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
		expect(tableNames(db)).toEqual(["entries", "hosts", "jobs", "repos"]);
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
});
