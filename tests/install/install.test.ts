import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import { chmod, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { hostPlatform } from "../../scripts/entry-module.ts";
import {
	defaultChecksums,
	type ReleaseStub,
	STUB_BINARY,
	STUB_REPO,
	STUB_TAG,
	sha256,
	startReleaseStub,
} from "./stub.ts";

const script = resolve(import.meta.dir, "..", "..", "install.sh");
const asset = `notam-${hostPlatform()}`;

const dirs: string[] = [];
let stub: ReleaseStub;
let home: string;

async function tempDir(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "notam-install-"));
	dirs.push(dir);
	return dir;
}

type Result = { code: number; stdout: string; stderr: string };

async function install(
	args: string[],
	env: Record<string, string> = {},
): Promise<Result> {
	const proc = Bun.spawn(["sh", script, ...args], {
		env: {
			PATH: process.env.PATH ?? "",
			HOME: home,
			NOTAM_REPO: STUB_REPO,
			NOTAM_API_BASE: stub.url,
			NOTAM_DOWNLOAD_BASE: stub.url,
			...env,
		},
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

beforeAll(async () => {
	stub = startReleaseStub();
	home = await tempDir();
});

beforeEach(() => stub.reset());

afterAll(async () => {
	await stub.close();
	for (const dir of dirs) await rm(dir, { recursive: true, force: true });
});

describe("install.sh", () => {
	test("installs the binary for this platform, executable", async () => {
		const dir = await tempDir();
		const result = await install(["--dir", dir]);

		expect(result.stderr).toBe("");
		expect(result.code).toBe(0);

		const target = join(dir, "notam");
		expect(await Bun.file(target).text()).toBe(STUB_BINARY);
		expect((await stat(target)).mode & 0o111).not.toBe(0);
		expect(result.stdout).toContain(`Downloading ${asset} ${STUB_TAG}`);
		expect(result.stdout).toContain(`Installed notam 1.2.3 to ${target}`);

		const proc = Bun.spawn([target], { stdout: "pipe" });
		expect(await new Response(proc.stdout).text()).toBe("1.2.3\n");
	});

	test("installs nothing when the checksum does not match", async () => {
		const dir = await tempDir();
		stub.setChecksums(`${"0".repeat(64)}  ${asset}\n`);

		const result = await install(["--dir", dir]);
		expect(result.code).not.toBe(0);
		expect(result.stderr).toContain(`Checksum mismatch for ${asset}`);
		expect(result.stderr).toContain("Nothing was installed.");
		expect(await Bun.file(join(dir, "notam")).exists()).toBe(false);
	});

	test("installs nothing when SHA256SUMS has no line for this platform", async () => {
		const dir = await tempDir();
		stub.setChecksums(`${sha256(STUB_BINARY)}  notam-solaris-sparc\n`);

		const result = await install(["--dir", dir]);
		expect(result.code).not.toBe(0);
		expect(result.stderr).toContain(`SHA256SUMS has no entry for ${asset}`);
		expect(await Bun.file(join(dir, "notam")).exists()).toBe(false);
	});

	test("names the URL when a download is missing", async () => {
		const dir = await tempDir();
		const result = await install(["--dir", dir], { NOTAM_VERSION: "v9.9.9" });

		expect(result.code).not.toBe(0);
		expect(result.stderr).toContain(`/releases/download/v9.9.9/${asset}`);
		expect(await Bun.file(join(dir, "notam")).exists()).toBe(false);
	});

	test("a pinned NOTAM_VERSION skips the latest-release lookup", async () => {
		const dir = await tempDir();
		// No leading v: the installer normalises it to the tag.
		const result = await install(["--dir", dir], { NOTAM_VERSION: "1.2.3" });

		expect(result.code).toBe(0);
		expect(stub.requests).not.toContain(`/repos/${STUB_REPO}/releases/latest`);
		expect(stub.requests).toContain(
			`/${STUB_REPO}/releases/download/${STUB_TAG}/${asset}`,
		);
	});

	test("--dir wins over NOTAM_DIR", async () => {
		const chosen = await tempDir();
		const ignored = await tempDir();

		expect(
			(await install(["--dir", chosen], { NOTAM_DIR: ignored })).code,
		).toBe(0);
		expect(await Bun.file(join(chosen, "notam")).exists()).toBe(true);
		expect(await Bun.file(join(ignored, "notam")).exists()).toBe(false);
	});

	test("NOTAM_DIR is used when --dir is absent", async () => {
		const dir = await tempDir();
		expect((await install([], { NOTAM_DIR: dir })).code).toBe(0);
		expect(await Bun.file(join(dir, "notam")).exists()).toBe(true);
	});

	test("creates the install directory when it does not exist", async () => {
		const dir = join(await tempDir(), "nested", "bin");
		expect((await install(["--dir", dir])).code).toBe(0);
		expect(await Bun.file(join(dir, "notam")).exists()).toBe(true);
	});

	test("reports the version it is replacing", async () => {
		const dir = await tempDir();
		const target = join(dir, "notam");
		await Bun.write(target, "#!/bin/sh\necho 0.9.0\n");
		await chmod(target, 0o755);

		const result = await install(["--dir", dir]);
		expect(result.code).toBe(0);
		expect(result.stdout).toContain(
			`Upgrading the existing install at ${target}`,
		);
		expect(result.stdout).toContain("0.9.0");
		expect(await Bun.file(target).text()).toBe(STUB_BINARY);
	});

	test("says `unknown version` when the existing install will not run", async () => {
		const dir = await tempDir();
		const target = join(dir, "notam");
		await Bun.write(target, "not an executable at all");

		const result = await install(["--dir", dir]);
		expect(result.code).toBe(0);
		expect(result.stdout).toContain("unknown version");
		expect(await Bun.file(target).text()).toBe(STUB_BINARY);
	});

	test("prints a PATH hint when the directory is not on PATH", async () => {
		const dir = await tempDir();
		const result = await install(["--dir", dir]);

		expect(result.stdout).toContain(`${dir} is not on your PATH`);
		expect(result.stdout).toContain(`export PATH="${dir}:$PATH"`);
	});

	test("prints no PATH hint when the directory is already on PATH", async () => {
		const dir = await tempDir();
		const result = await install(["--dir", dir], {
			PATH: `${dir}:${process.env.PATH ?? ""}`,
		});

		expect(result.code).toBe(0);
		expect(result.stdout).not.toContain("is not on your PATH");
	});

	test("warns when another notam earlier on PATH would win", async () => {
		const dir = await tempDir();
		const shadow = await tempDir();
		await Bun.write(join(shadow, "notam"), "#!/bin/sh\necho 0.0.1\n");
		await chmod(join(shadow, "notam"), 0o755);

		const result = await install(["--dir", dir], {
			PATH: `${shadow}:${dir}:${process.env.PATH ?? ""}`,
		});

		expect(result.code).toBe(0);
		expect(result.stdout).toContain(`will win: ${join(shadow, "notam")}`);
	});

	test("--help prints usage and touches nothing", async () => {
		const result = await install(["--help"]);

		expect(result.code).toBe(0);
		expect(result.stdout).toContain("Usage: install.sh");
		expect(stub.requests).toEqual([]);
	});

	test("rejects an unknown argument", async () => {
		const result = await install(["--fast"]);

		expect(result.code).not.toBe(0);
		expect(result.stderr).toContain('Unknown argument "--fast"');
		expect(stub.requests).toEqual([]);
	});

	test("the default checksums cover this platform", () => {
		expect(defaultChecksums()).toContain(`  ${asset}\n`);
	});
});
