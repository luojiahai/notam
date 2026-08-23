import { Database } from "bun:sqlite";
import { copyFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * Opens the database with the pragmas NOTAM depends on:
 * WAL so a read during a long sync does not block, and foreign keys ON so the
 * repo -> entry cascade in the schema is actually enforced (SQLite defaults it off).
 */
export function openDatabase(path: string): Database {
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

export async function ensureParentDir(
	path: string,
	mode = 0o700,
): Promise<void> {
	await mkdir(dirname(path), { recursive: true, mode });
}
