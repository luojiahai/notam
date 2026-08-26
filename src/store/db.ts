import { Database } from "bun:sqlite";
import { chmodSync, mkdirSync } from "node:fs";
import { chmod, copyFile } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * Creates `path`'s parent directory (and any missing ancestors) synchronously
 * at mode 0700, and repairs the mode when the directory already existed:
 * `mkdirSync`'s `mode` option only applies to a directory it actually creates,
 * so a `~/.notam` the user made themselves (a fully supported path) would
 * otherwise be left at whatever mode `mkdir` defaulted to. A no-op for
 * ":memory:".
 */
function ensureParentDirSync(path: string, mode = 0o700): void {
	if (path === ":memory:") return;
	const dir = dirname(path);
	mkdirSync(dir, { recursive: true, mode });
	chmodSync(dir, mode);
}

/**
 * Opens the database with the pragmas NOTAM depends on:
 * WAL so a read during a long sync does not block, and foreign keys ON so the
 * repo -> entry cascade in the schema is actually enforced (SQLite defaults it off).
 * Creates the parent directory (mode 0700, repaired if it already existed)
 * first, so any caller can open a fresh path under ~/.notam without a prior
 * mkdir. The database file itself is chmod'd to 0600 after opening — `bun:sqlite`
 * creates it at the process's default mode, which is not private on its own.
 */
export function openDatabase(path: string): Database {
	ensureParentDirSync(path);
	const db = new Database(path, { create: true });
	if (path !== ":memory:") chmodSync(path, 0o600);
	db.exec("PRAGMA journal_mode = WAL;");
	db.exec("PRAGMA foreign_keys = ON;");
	db.exec("PRAGMA busy_timeout = 5000;");
	return db;
}

/** Copies `path` to `path.<timestamp>.bak`, mode 0600. Returns null when there is no file yet. */
export async function backupDatabase(
	path: string,
	now: Date = new Date(),
): Promise<string | null> {
	if (!(await Bun.file(path).exists())) return null;
	const stamp = now.toISOString().replace(/[:.]/g, "-");
	const target = `${path}.${stamp}.bak`;
	await copyFile(path, target);
	await chmod(target, 0o600);
	return target;
}
