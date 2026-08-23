import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, statSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { backupDatabase, openDatabase } from "../../src/store/db.ts";

let dir: string;
beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "notam-store-db-"));
});
afterEach(async () => {
	await rm(dir, { recursive: true, force: true });
});

/** Reads the real filesystem mode bits — the requested mode proves nothing, since umask can strip bits. */
function modeOf(path: string): number {
	return statSync(path).mode & 0o777;
}

describe("openDatabase", () => {
	test("repairs a pre-existing 0755 ~/.notam directory to 0700", () => {
		// Simulates `mkdir ~/.notam && vim config.yaml && notam sync` — a fully
		// supported path, since `notam init` is not required. mkdirSync's `mode`
		// option is a no-op on a directory that already exists, which is exactly
		// the bug: only an explicit chmod on every open fixes it.
		mkdirSync(dir, { recursive: true });
		chmodSync(dir, 0o755);
		expect(modeOf(dir)).toBe(0o755);

		openDatabase(join(dir, "notam.db")).close();

		expect(modeOf(dir)).toBe(0o700);
	});

	test("creates a freshly opened notam.db at mode 0600", () => {
		const path = join(dir, "notam.db");
		openDatabase(path).close();
		expect(modeOf(path)).toBe(0o600);
	});

	test("is a no-op for :memory:", () => {
		// Must not throw trying to chmod a path that names no real file.
		expect(() => openDatabase(":memory:").close()).not.toThrow();
	});
});

describe("backupDatabase", () => {
	test("creates the backup copy at mode 0600", async () => {
		const path = join(dir, "notam.db");
		openDatabase(path).close();
		// Prove the backup sets the mode itself rather than carrying the source
		// file's: widen the source before backing it up.
		chmodSync(path, 0o644);

		const backup = await backupDatabase(
			path,
			new Date("2026-08-23T09:15:00.000Z"),
		);
		if (!backup) throw new Error("expected a backup path");

		expect(modeOf(backup)).toBe(0o600);
	});
});
