import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { copyFile } from "node:fs/promises";
import { dirname } from "node:path";

/** Creates `path`'s parent directory (and any missing ancestors) synchronously at mode 0700. A no-op for ":memory:" or an already-existing directory. */
function ensureParentDirSync(path: string, mode = 0o700): void {
	if (path === ":memory:") return;
	mkdirSync(dirname(path), { recursive: true, mode });
}

/**
 * Opens the database with the pragmas NOTAM depends on:
 * WAL so a read during a long sync does not block, and foreign keys ON so the
 * repo -> entry cascade in the schema is actually enforced (SQLite defaults it off).
 * Creates the parent directory (mode 0700) first, so any caller can open a
 * fresh path under ~/.notam without a prior mkdir.
 */
export function openDatabase(path: string): Database {
	ensureParentDirSync(path);
	const db = new Database(path, { create: true });
	db.exec("PRAGMA journal_mode = WAL;");
	db.exec("PRAGMA foreign_keys = ON;");
	db.exec("PRAGMA busy_timeout = 5000;");
	return db;
}

/** Copies `path` to `path.<timestamp>.bak`. Returns null when there is no file yet. */
export async function backupDatabase(
	path: string,
	now: Date = new Date(),
): Promise<string | null> {
	if (!(await Bun.file(path).exists())) return null;
	const stamp = now.toISOString().replace(/[:.]/g, "-");
	const target = `${path}.${stamp}.bak`;
	await copyFile(path, target);
	return target;
}
