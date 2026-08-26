import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
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

describe("notam with no command", () => {
	test("takes a leading flag as its own, not as a command", async () => {
		// --port is rejected for its value rather than for being unrecognised,
		// which is only possible if a leading flag routed to the server.
		const result = await notam(["--port", "99999"]);
		expect(result.exitCode).toBe(1);
		expect(result.output).toContain("--port must be an integer");
	});

	test("writes no config when it refuses a flag", async () => {
		await notam(["--port", "99999"]);
		expect(await Bun.file(join(home, ".notam", "config.yaml")).exists()).toBe(
			false,
		);
	});
});

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

describe("notam --help", () => {
	test("prints usage and exits zero", async () => {
		const result = await notam(["--help"]);
		expect(result.exitCode).toBe(0);
		expect(result.output).toContain("Usage");
	});

	test("lists every command", async () => {
		const result = await notam(["--help"]);
		expect(result.output).toContain("notam update");
		expect(result.output).toContain("notam version");
		expect(result.output).toContain("--no-open");
	});

	test("wins over a command, so a mistyped flag never starts a server", async () => {
		const result = await notam(["update", "--help"]);
		expect(result.exitCode).toBe(0);
		expect(result.output).toContain("Usage");
		expect(result.output).not.toContain("running from source");
	});
});

describe("unknown commands", () => {
	test("names the one it was given, and prints usage", async () => {
		const result = await notam(["frobnicate"]);
		expect(result.exitCode).not.toBe(0);
		expect(result.output).toContain("frobnicate");
		expect(result.output).toContain("Usage");
	});

	test.each([
		["run", "notam` on its own"],
		["init", "created on first run"],
		["sync", "curl -X POST"],
	])("%s says what replaced it", async (command, replacement) => {
		const result = await notam([command]);
		expect(result.exitCode).not.toBe(0);
		expect(result.output).toContain(replacement);
	});

	test("a removed command does not dump the whole usage over its message", async () => {
		const result = await notam(["sync"]);
		expect(result.output).not.toContain("Environment:");
	});
});

describe("notam update", () => {
	test("refuses to update a binary that is running from source", async () => {
		const result = await notam(["update"]);
		expect(result.exitCode).toBe(1);
		expect(result.output).toContain("running from source");
		// A refusal, not a crash: no stack reaches the user.
		expect(result.output).not.toContain("    at ");
	});

	test("refuses before reaching the network", async () => {
		// An unroutable base: anything that resolved a release would hang or
		// fail here rather than reporting the refusal.
		const result = await notam(["update"], {
			NOTAM_API_BASE: "http://127.0.0.1:1",
		});
		expect(result.output).toContain("running from source");
	});

	test("reports a --version with no value", async () => {
		const result = await notam(["update", "--version"]);
		expect(result.exitCode).toBe(1);
		expect(result.output).toContain("--version needs a value");
	});

	test("reports an unknown --version tag without a stack trace", async () => {
		// An unroutable API base: the failure comes from the transport, which is
		// the path most likely to surface a raw error to the user.
		const result = await notam(["update", "--version", "9.9.9"], {
			NOTAM_DOWNLOAD_BASE: "http://127.0.0.1:1",
		});
		expect(result.exitCode).toBe(1);
		expect(result.output).not.toContain("    at ");
	});

	test("--help documents the update command and its release overrides", async () => {
		const result = await notam(["--help"]);
		expect(result.output).toContain("notam update");
		expect(result.output).toContain("NOTAM_DOWNLOAD_BASE");
	});
});
