import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ENTRY = join(import.meta.dir, "../../src/cli/index.ts");

let home: string;
beforeEach(async () => {
	home = await mkdtemp(join(tmpdir(), "notam-cli-"));
});
afterEach(async () => {
	await rm(home, { recursive: true, force: true });
});

async function notam(args: string[], env: Record<string, string> = {}) {
	// process.execPath, not "bun": one test blanks PATH, which would otherwise
	// hide the runtime itself rather than just the claude CLI.
	const proc = Bun.spawn([process.execPath, "run", ENTRY, ...args], {
		env: { PATH: process.env.PATH ?? "", NOTAM_HOME: home, ...env },
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	return { stdout, stderr, exitCode, output: stdout + stderr };
}

const VALID_CONFIG = `hosts:
  - id: github
    api_base: https://api.github.com
    graphql: https://api.github.com/graphql
    token_env: NOTAM_TEST_TOKEN
repos:
  - host: github
    name: acme/monolith
`;

async function writeConfig(contents = VALID_CONFIG) {
	await Bun.write(join(home, ".notam", "config.yaml"), contents);
}

describe("notam version", () => {
	test("prints a version and exits zero", async () => {
		const result = await notam(["version"]);
		expect(result.exitCode).toBe(0);
		expect(result.stdout.trim()).toBe("dev");
	});

	test("is also available as --version", async () => {
		expect((await notam(["--version"])).stdout.trim()).toBe("dev");
	});
});

describe("notam (no command)", () => {
	test("prints usage listing every command and exits non-zero", async () => {
		const result = await notam([]);
		expect(result.exitCode).not.toBe(0);
		expect(result.output).toContain("notam init");
		expect(result.output).toContain("notam sync");
		expect(result.output).toContain("notam version");
	});

	test("prints usage and exits zero for --help", async () => {
		const result = await notam(["--help"]);
		expect(result.exitCode).toBe(0);
		expect(result.output).toContain("Usage");
	});

	test("names the unknown command it was given", async () => {
		const result = await notam(["frobnicate"]);
		expect(result.exitCode).not.toBe(0);
		expect(result.output).toContain("frobnicate");
	});
});

describe("notam init", () => {
	test("writes a commented config and reports where", async () => {
		const result = await notam(["init"]);
		expect(result.exitCode).toBe(0);
		const path = join(home, ".notam", "config.yaml");
		expect(result.output).toContain(path);
		const contents = await Bun.file(path).text();
		expect(contents).toContain("token_env: NOTAM_GITHUB_TOKEN");
		expect(contents).toContain("# NOTAM configuration");
	});

	test("creates the config readable only by its owner", async () => {
		await notam(["init"]);
		const fileMode =
			(await stat(join(home, ".notam", "config.yaml"))).mode & 0o777;
		const dirMode = (await stat(join(home, ".notam"))).mode & 0o777;
		expect(fileMode).toBe(0o600);
		expect(dirMode).toBe(0o700);
	});

	test("refuses to clobber an existing config", async () => {
		await notam(["init"]);
		await writeFile(join(home, ".notam", "config.yaml"), "hand: edited\n");
		const result = await notam(["init"]);
		expect(result.exitCode).not.toBe(0);
		expect(result.output).toContain("--force");
		expect(await Bun.file(join(home, ".notam", "config.yaml")).text()).toBe(
			"hand: edited\n",
		);
	});

	test("overwrites when told to", async () => {
		await notam(["init"]);
		await writeFile(join(home, ".notam", "config.yaml"), "hand: edited\n");
		const result = await notam(["init", "--force"]);
		expect(result.exitCode).toBe(0);
		expect(
			await Bun.file(join(home, ".notam", "config.yaml")).text(),
		).toContain("# NOTAM configuration");
	});

	test("warns when the claude CLI is not on PATH", async () => {
		const result = await notam(["init"], { PATH: "/nonexistent" });
		expect(result.output).toContain("claude");
	});
});

describe("notam sync", () => {
	test("refuses to run without a config and points at notam init", async () => {
		const result = await notam(["sync"]);
		expect(result.exitCode).not.toBe(0);
		expect(result.output).toContain("notam init");
	});

	test("refuses to run on an invalid config, naming the offending path", async () => {
		await writeConfig(VALID_CONFIG.replace("acme/monolith", "monolith"));
		const result = await notam(["sync"], { NOTAM_TEST_TOKEN: "t" });
		expect(result.exitCode).not.toBe(0);
		expect(result.output).toContain("repos[0].name");
	});

	test("refuses to run when a token environment variable is unset, naming it", async () => {
		await writeConfig();
		const result = await notam(["sync"]);
		expect(result.exitCode).not.toBe(0);
		expect(result.output).toContain("NOTAM_TEST_TOKEN");
	});

	test("creates the database and migrates it before doing any work", async () => {
		await writeConfig();
		await notam(["sync", "--repo", "acme/nonexistent"], {
			NOTAM_TEST_TOKEN: "t",
		});
		expect(await Bun.file(join(home, ".notam", "notam.db")).exists()).toBe(
			true,
		);
	});

	test("reports when --repo matches nothing, rather than silently doing nothing", async () => {
		await writeConfig();
		const result = await notam(["sync", "--repo", "acme/nonexistent"], {
			NOTAM_TEST_TOKEN: "t",
		});
		expect(result.exitCode).not.toBe(0);
		expect(result.output).toContain("acme/nonexistent");
	});
});
