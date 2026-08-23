import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	renderChecksums,
	sha256OfFile,
	writeChecksums,
} from "../../scripts/checksums.ts";

const dirs: string[] = [];

async function releaseDir(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "notam-sums-"));
	dirs.push(dir);
	await Bun.write(join(dir, "notam-darwin-arm64"), "mac arm binary");
	await Bun.write(join(dir, "notam-linux-x64"), "linux x64 binary");
	await Bun.write(join(dir, "notes.txt"), "not a release asset");
	return dir;
}

afterAll(async () => {
	for (const dir of dirs) await rm(dir, { recursive: true, force: true });
});

describe("renderChecksums", () => {
	test("is `<sha>  <name>` per line, sorted by name, newline-terminated", () => {
		expect(
			renderChecksums([
				{ name: "notam-linux-x64", sha256: "b".repeat(64) },
				{ name: "notam-darwin-arm64", sha256: "a".repeat(64) },
			]),
		).toBe(
			`${"a".repeat(64)}  notam-darwin-arm64\n${"b".repeat(64)}  notam-linux-x64\n`,
		);
	});
});

describe("sha256OfFile", () => {
	test("hashes the file's bytes", async () => {
		const dir = await releaseDir();
		expect(await sha256OfFile(join(dir, "notam-darwin-arm64"))).toBe(
			new Bun.CryptoHasher("sha256").update("mac arm binary").digest("hex"),
		);
	});
});

describe("writeChecksums", () => {
	test("covers every notam-* asset and nothing else", async () => {
		const dir = await releaseDir();
		const text = await writeChecksums(dir);

		expect(text).toContain("  notam-darwin-arm64\n");
		expect(text).toContain("  notam-linux-x64\n");
		expect(text).not.toContain("notes.txt");
		expect(await Bun.file(join(dir, "SHA256SUMS")).text()).toBe(text);
	});

	test("produces a file the system's own checker accepts", async () => {
		const dir = await releaseDir();
		await writeChecksums(dir);

		const checker = Bun.which("sha256sum")
			? ["sha256sum", "-c", "SHA256SUMS"]
			: ["shasum", "-a", "256", "-c", "SHA256SUMS"];
		const proc = Bun.spawn(checker, {
			cwd: dir,
			stdout: "pipe",
			stderr: "pipe",
		});
		expect(await proc.exited).toBe(0);
	});

	test("refuses an empty directory rather than writing an empty manifest", async () => {
		const dir = await mkdtemp(join(tmpdir(), "notam-sums-empty-"));
		dirs.push(dir);
		await expect(writeChecksums(dir)).rejects.toThrow("No notam-* files");
	});
});
