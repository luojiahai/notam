import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, lstatSync } from "node:fs";
import {
	chmod,
	mkdir,
	mkdtemp,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const script = resolve(import.meta.dir, "..", "..", "uninstall.sh");

// A minimal PATH, so a notam the developer actually has installed cannot drift
// into the shadowing assertions. sh, rm, rmdir and ls all live here.
const BASE_PATH = "/usr/bin:/bin";

const dirs: string[] = [];

async function tempDir(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "notam-uninstall-"));
	dirs.push(dir);
	return dir;
}

type Result = { code: number; stdout: string; stderr: string };

async function uninstall(
	args: string[],
	env: Record<string, string> = {},
	stdin: "ignore" | Blob = "ignore",
): Promise<Result> {
	const proc = Bun.spawn(["sh", script, ...args], {
		env: { PATH: BASE_PATH, ...env },
		stdin,
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, stderr, code] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	return { code, stdout, stderr };
}

/** Writes everything NOTAM itself puts in ~/.notam, and returns that directory. */
async function seedData(home: string): Promise<string> {
	const data = join(home, ".notam");
	await mkdir(data, { recursive: true, mode: 0o700 });
	await writeFile(join(data, "config.yaml"), "hosts: []\n", { mode: 0o600 });
	await writeFile(join(data, "notam.db"), "sqlite", { mode: 0o600 });
	await writeFile(join(data, "notam.db-wal"), "wal", { mode: 0o600 });
	await writeFile(join(data, "notam.db-shm"), "shm", { mode: 0o600 });
	await writeFile(join(data, "notam.db.2026-01-02T03-04-05-000Z.bak"), "old", {
		mode: 0o600,
	});
	return data;
}

async function seedBinary(dir: string): Promise<string> {
	const target = join(dir, "notam");
	await writeFile(target, "#!/bin/sh\necho 1.2.3\n");
	await chmod(target, 0o755);
	return target;
}

/** existsSync follows symlinks, which is the wrong question for the link itself. */
function linkExists(path: string): boolean {
	try {
		lstatSync(path);
		return true;
	} catch {
		return false;
	}
}

afterAll(async () => {
	for (const dir of dirs) await rm(dir, { recursive: true, force: true });
});

describe("uninstall.sh", () => {
	test("--purge removes the binary, every file NOTAM wrote, and the directory", async () => {
		const home = await tempDir();
		const dir = await tempDir();
		const data = await seedData(home);
		const target = await seedBinary(dir);

		const result = await uninstall(["--dir", dir, "--purge"], { HOME: home });

		expect(result.stderr).toBe("");
		expect(result.code).toBe(0);
		expect(existsSync(target)).toBe(false);
		for (const name of [
			"config.yaml",
			"notam.db",
			"notam.db-wal",
			"notam.db-shm",
			"notam.db.2026-01-02T03-04-05-000Z.bak",
		]) {
			expect(existsSync(join(data, name))).toBe(false);
		}
		expect(existsSync(data)).toBe(false);
	});

	test("--purge removes the directory itself once it holds nothing else", async () => {
		const home = await tempDir();
		const dir = await tempDir();
		const data = join(home, ".notam");
		await mkdir(data, { recursive: true, mode: 0o700 });
		await writeFile(join(data, "config.yaml"), "hosts: []\n", { mode: 0o600 });
		await seedBinary(dir);

		const result = await uninstall(["--dir", dir, "--purge"], { HOME: home });

		expect(result.code).toBe(0);
		expect(existsSync(data)).toBe(false);
		expect(result.stdout).not.toContain("still contains files");
	});

	test("--purge keeps files NOTAM never wrote, and says the directory stayed", async () => {
		const home = await tempDir();
		const dir = await tempDir();
		const data = await seedData(home);
		await mkdir(join(data, "prompts"), { recursive: true });
		await writeFile(join(data, "prompts", "owner-repo.md"), "# hand written\n");
		await seedBinary(dir);

		const result = await uninstall(["--dir", dir, "--purge"], { HOME: home });

		expect(result.code).toBe(0);
		expect(existsSync(join(data, "notam.db"))).toBe(false);
		expect(existsSync(join(data, "prompts", "owner-repo.md"))).toBe(true);
		expect(result.stdout).toContain(
			"still contains files NOTAM did not create",
		);
	});

	test("--keep-data removes the binary and leaves ~/.notam alone", async () => {
		const home = await tempDir();
		const dir = await tempDir();
		const data = await seedData(home);
		const target = await seedBinary(dir);

		const result = await uninstall(["--dir", dir, "--keep-data"], {
			HOME: home,
		});

		expect(result.stderr).toBe("");
		expect(result.code).toBe(0);
		expect(existsSync(target)).toBe(false);
		expect(existsSync(join(data, "config.yaml"))).toBe(true);
		expect(existsSync(join(data, "notam.db"))).toBe(true);
		expect(
			existsSync(join(data, "notam.db.2026-01-02T03-04-05-000Z.bak")),
		).toBe(true);
		expect(result.stdout).toContain(`Keeping ${data}`);
	});

	test("with no terminal to ask on, it keeps the data and says why", async () => {
		const home = await tempDir();
		const dir = await tempDir();
		const data = await seedData(home);
		const target = await seedBinary(dir);

		const result = await uninstall(["--dir", dir], { HOME: home });

		expect(result.code).toBe(0);
		expect(existsSync(target)).toBe(false);
		expect(existsSync(join(data, "notam.db"))).toBe(true);
		expect(result.stdout).toContain("No terminal to ask on");
		expect(result.stdout).toContain("--purge");
	});

	test("piped as `curl | sh`, it neither consumes the script nor reads it as an answer", async () => {
		const home = await tempDir();
		const dir = await tempDir();
		const data = await seedData(home);
		await seedBinary(dir);

		// Exactly what `curl -fsSL ... | sh` does: the script arrives on stdin.
		const result = await uninstall(
			["--dir", dir],
			{ HOME: home },
			Bun.file(script),
		);

		expect(result.code).toBe(0);
		expect(existsSync(join(data, "notam.db"))).toBe(true);
		expect(result.stdout).not.toContain("Deleting");
		// Nothing from the script's own text may surface as though it were input.
		expect(result.stderr).toBe("");
	});

	test("a binary that is already gone is not an error, and the data is still handled", async () => {
		const home = await tempDir();
		const dir = await tempDir();
		const data = await seedData(home);

		const result = await uninstall(["--dir", dir, "--purge"], { HOME: home });

		expect(result.code).toBe(0);
		expect(result.stdout).toContain(`No notam at ${join(dir, "notam")}`);
		expect(existsSync(data)).toBe(false);
	});

	test("nothing installed at all succeeds without reporting a deletion", async () => {
		const home = await tempDir();
		const dir = await tempDir();

		const result = await uninstall(["--dir", dir, "--purge"], { HOME: home });

		expect(result.stderr).toBe("");
		expect(result.code).toBe(0);
		expect(result.stdout).toContain("No notam at");
		expect(result.stdout).not.toContain("Deleting");
		expect(result.stdout).not.toContain("Removed");
	});

	test("--keep-data and --purge together refuse, leaving everything in place", async () => {
		const home = await tempDir();
		const dir = await tempDir();
		const data = await seedData(home);
		const target = await seedBinary(dir);

		const result = await uninstall(["--dir", dir, "--purge", "--keep-data"], {
			HOME: home,
		});

		expect(result.code).not.toBe(0);
		expect(result.stderr).toContain("contradict");
		expect(existsSync(target)).toBe(true);
		expect(existsSync(join(data, "notam.db"))).toBe(true);
	});

	test("NOTAM_HOME decides where the data is, over HOME", async () => {
		const home = await tempDir();
		const elsewhere = await tempDir();
		const dir = await tempDir();
		const ignored = await seedData(home);
		const data = await seedData(elsewhere);

		const result = await uninstall(["--dir", dir, "--purge"], {
			HOME: home,
			NOTAM_HOME: elsewhere,
		});

		expect(result.code).toBe(0);
		expect(existsSync(data)).toBe(false);
		expect(existsSync(join(ignored, "notam.db"))).toBe(true);
	});

	test("another notam on PATH is reported, never removed", async () => {
		const home = await tempDir();
		const dir = await tempDir();
		const other = await tempDir();
		await seedBinary(dir);
		const survivor = await seedBinary(other);

		const result = await uninstall(["--dir", dir, "--keep-data"], {
			HOME: home,
			PATH: `${other}:${BASE_PATH}`,
		});

		expect(result.code).toBe(0);
		expect(existsSync(survivor)).toBe(true);
		expect(result.stdout).toContain(
			`another notam is still on your PATH: ${survivor}`,
		);
	});

	test("a symlinked binary is unlinked, not followed to what it points at", async () => {
		const home = await tempDir();
		const dir = await tempDir();
		const build = await tempDir();
		const real = join(build, "notam-dev-build");
		await writeFile(real, "#!/bin/sh\necho dev\n");
		await chmod(real, 0o755);
		const target = join(dir, "notam");
		await symlink(real, target);

		const result = await uninstall(["--dir", dir, "--keep-data"], {
			HOME: home,
		});

		expect(result.code).toBe(0);
		expect(linkExists(target)).toBe(false);
		expect(existsSync(real)).toBe(true);
		expect(result.stdout).toContain(`Removed ${target}`);
	});

	// root ignores the mode bits this relies on, so there would be nothing to
	// fail and the assertions below would invert.
	test.skipIf(process.getuid?.() === 0)(
		"a removal it cannot perform is reported and collected, not fatal",
		async () => {
			const home = await tempDir();
			const dir = await tempDir();
			const data = await seedData(home);
			const target = await seedBinary(dir);
			await chmod(data, 0o500);

			const result = await uninstall(["--dir", dir, "--purge"], { HOME: home });

			await chmod(data, 0o700);
			expect(result.code).toBe(1);
			// Every file is attempted, and each failure names its path and the way past it.
			expect(result.stderr).toContain(
				`${join(data, "config.yaml")}. Try again with sudo.`,
			);
			expect(result.stderr).toContain(
				`${join(data, "notam.db")}. Try again with sudo.`,
			);
			// What is left is NOTAM's own, so it must not be blamed on the user.
			expect(result.stdout).not.toContain("NOTAM did not create");
			// Partial progress is still progress: the binary goes regardless.
			expect(existsSync(target)).toBe(false);
		},
	);

	test("an unknown argument prints usage on stderr and fails", async () => {
		const home = await tempDir();
		const dir = await tempDir();
		const target = await seedBinary(dir);

		const result = await uninstall(["--dir", dir, "--wipe"], { HOME: home });

		expect(result.code).not.toBe(0);
		expect(result.stderr).toContain("Usage: uninstall.sh");
		expect(result.stderr).toContain('Unknown argument "--wipe"');
		expect(result.stdout).toBe("");
		expect(existsSync(target)).toBe(true);
	});

	test("--help prints usage and removes nothing", async () => {
		const home = await tempDir();
		const dir = await tempDir();
		const target = await seedBinary(dir);
		const data = await seedData(home);

		const result = await uninstall(["--dir", dir, "--help"], { HOME: home });

		expect(result.code).toBe(0);
		expect(result.stdout).toContain("Usage: uninstall.sh");
		expect(existsSync(target)).toBe(true);
		expect(existsSync(join(data, "notam.db"))).toBe(true);
	});
});
