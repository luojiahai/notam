import type { Database } from "bun:sqlite";
import { backupDatabase, openDatabase } from "./db.ts";

export type Migration = { version: number; name: string; sql: string };

/**
 * Forward-only. Never edit a migration that has shipped — add a new one.
 * `rules` and `promotions` arrive in migration 002, added by the analysis and
 * promotion plan.
 */
export const MIGRATIONS: Migration[] = [
	{
		version: 1,
		name: "hosts_repos_entries_jobs",
		sql: `
CREATE TABLE hosts (
	id         TEXT PRIMARY KEY,
	label      TEXT NOT NULL,
	api_base   TEXT NOT NULL,
	graphql    TEXT NOT NULL,
	token_env  TEXT NOT NULL
);

CREATE TABLE repos (
	id              TEXT PRIMARY KEY,
	host_id         TEXT NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
	name            TEXT NOT NULL,
	path_globs      TEXT NOT NULL DEFAULT '[]',
	default_branch  TEXT NOT NULL DEFAULT 'main',
	window_days     INTEGER NOT NULL DEFAULT 180,
	prompt_template TEXT,
	sync_watermark  TEXT,
	created_at      TEXT NOT NULL
);
CREATE UNIQUE INDEX repos_host_name ON repos(host_id, name);

CREATE TABLE entries (
	id              TEXT PRIMARY KEY,
	repo_id         TEXT NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
	kind            TEXT NOT NULL DEFAULT 'pr',
	number          INTEGER NOT NULL,
	title           TEXT NOT NULL,
	author          TEXT NOT NULL,
	url             TEXT NOT NULL,
	merged_at       TEXT,
	updated_at      TEXT NOT NULL,
	payload_json    TEXT NOT NULL,
	changed_paths   TEXT NOT NULL DEFAULT '[]',
	paths_truncated INTEGER NOT NULL DEFAULT 0,
	analysis_state  TEXT NOT NULL DEFAULT 'unanalysed',
	analysed_at     TEXT,
	last_error      TEXT,
	created_at      TEXT NOT NULL
);
CREATE UNIQUE INDEX entries_repo_kind_number ON entries(repo_id, kind, number);
CREATE INDEX entries_repo_state ON entries(repo_id, analysis_state);
CREATE INDEX entries_repo_updated ON entries(repo_id, updated_at DESC);

CREATE TABLE jobs (
	id          TEXT PRIMARY KEY,
	kind        TEXT NOT NULL,
	target_id   TEXT NOT NULL,
	state       TEXT NOT NULL DEFAULT 'queued',
	attempts    INTEGER NOT NULL DEFAULT 0,
	error       TEXT,
	created_at  TEXT NOT NULL,
	started_at  TEXT,
	finished_at TEXT
);
CREATE INDEX jobs_state_created ON jobs(state, created_at, id);
CREATE UNIQUE INDEX jobs_pending_target ON jobs(kind, target_id) WHERE state IN ('queued', 'running');
`,
	},
];

function currentVersion(db: Database): number {
	const row = db
		.query<{ user_version: number }, []>("PRAGMA user_version")
		.get();
	return row?.user_version ?? 0;
}

/** Applies every migration above the current user_version. Returns how many ran. */
export function applyMigrations(db: Database): number {
	const from = currentVersion(db);
	const pending = MIGRATIONS.filter((m) => m.version > from);
	for (const migration of pending) {
		db.transaction(() => {
			db.exec(migration.sql);
			// user_version does not accept a bound parameter, and the value is a
			// literal from this file, never user input.
			db.exec(`PRAGMA user_version = ${migration.version}`);
		})();
	}
	return pending.length;
}

export function pendingMigrationCount(db: Database): number {
	const from = currentVersion(db);
	return MIGRATIONS.filter((m) => m.version > from).length;
}

/**
 * The startup path: create ~/.notam if needed, back up only when a migration is
 * actually going to run, then migrate.
 */
export async function migrateDatabase(
	path: string,
	now: Date = new Date(),
): Promise<{ db: Database; applied: number; backup: string | null }> {
	// openDatabase creates the parent directory itself, so nothing to do here
	// beyond checking whether the file already existed before we touch it.
	const existed = path !== ":memory:" && (await Bun.file(path).exists());
	const db = openDatabase(path);
	let backup: string | null = null;
	if (existed && pendingMigrationCount(db) > 0) {
		db.close();
		backup = await backupDatabase(path, now);
		const reopened = openDatabase(path);
		return { db: reopened, applied: applyMigrations(reopened), backup };
	}
	return { db, applied: applyMigrations(db), backup };
}
