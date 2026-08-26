import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runSync } from "../../src/cli/sync.ts";
import { defaultDbPath } from "../../src/core/config/load.ts";
import type { GitHubClient } from "../../src/core/github/types.ts";
import { JobQueue } from "../../src/jobs/queue.ts";
import { migrateDatabase } from "../../src/store/migrations.ts";

const ENTRY = join(import.meta.dir, "../../src/cli/index.ts");

/**
 * A GitHubClient that never issues a request: used to exercise runSync's
 * success and failure-reporting paths offline, by injecting it via the
 * SyncOptions.clientFor seam instead of the CLI's default GraphQLGitHubClient.
 */
function fakeClient(): GitHubClient {
	return {
		listMergedPRs: async () => ({
			nodes: [],
			endCursor: null,
			hasNextPage: false,
		}),
		fetchPRDetail: async () => {
			throw new Error("fetchPRDetail should not be called in this test");
		},
	};
}

/** Runs `fn` with NOTAM_TEST_TOKEN set, restoring whatever was there before. */
async function withTestToken<T>(fn: () => Promise<T>): Promise<T> {
	const original = process.env.NOTAM_TEST_TOKEN;
	process.env.NOTAM_TEST_TOKEN = "t";
	try {
		return await fn();
	} finally {
		if (original === undefined) delete process.env.NOTAM_TEST_TOKEN;
		else process.env.NOTAM_TEST_TOKEN = original;
	}
}

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
		expect(result.output).toContain("notam update");
		expect(result.output).toContain("notam version");
	});

	test("prints usage and exits zero for --help", async () => {
		const result = await notam(["--help"]);
		expect(result.exitCode).toBe(0);
		expect(result.output).toContain("Usage");
	});

	test("--help documents the run command", async () => {
		const result = await notam(["--help"]);
		expect(result.exitCode).toBe(0);
		expect(result.output).toContain("notam run");
		expect(result.output).toContain("--no-open");
	});

	test("names the unknown command it was given", async () => {
		const result = await notam(["frobnicate"]);
		expect(result.exitCode).not.toBe(0);
		expect(result.output).toContain("frobnicate");
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
		// PATH is pinned to a directory with nothing in it, so the missing
		// branch is deterministic here regardless of whether this machine
		// happens to have the claude CLI installed.
		const result = await notam(["init"], { PATH: "/nonexistent" });
		expect(result.exitCode).toBe(0);
		expect(result.output).toContain("not found on PATH");
	});

	test("notam init --help prints help without writing a config", async () => {
		const result = await notam(["init", "--help"]);
		expect(result.exitCode).toBe(0);
		expect(result.output).toContain("Usage");
		expect(await Bun.file(join(home, ".notam", "config.yaml")).exists()).toBe(
			false,
		);
	});
});

describe("notam sync", () => {
	test("refuses to run without a config, naming the file it looked for", async () => {
		const result = await notam(["sync"]);
		expect(result.exitCode).not.toBe(0);
		expect(result.output).toContain("No config file at");
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

	test("notam sync --help prints help without attempting to sync", async () => {
		const result = await notam(["sync", "--help"]);
		expect(result.exitCode).toBe(0);
		expect(result.output).toContain("Usage");
		expect(await Bun.file(join(home, ".notam", "notam.db")).exists()).toBe(
			false,
		);
	});

	test("reports a sync job targeting an unknown repo as failed, without touching the network", async () => {
		await writeConfig();
		const dbPath = defaultDbPath(home);

		// Seed a "sync" job whose target_id names no repo in the store — as if a
		// Ctrl-C'd run left a job behind for a repository since removed from
		// config. This still drives the pool's real "sync" handler (the pool
		// only claims kinds it has a handler for — see notam/jobs/pool.ts), so
		// the failure comes from createSyncHandler's own unknown-repo guard,
		// entirely offline, rather than from an unregistered job kind. Opened
		// and closed before runSync's own migrateDatabase call, so there is only
		// ever one writer.
		const seeded = await migrateDatabase(dbPath);
		new JobQueue(seeded.db).enqueue("sync", "no-such-repo-id");
		seeded.db.close();

		const lines: string[] = [];
		const failed = await withTestToken(() =>
			runSync({
				home,
				concurrency: 1,
				log: (line) => lines.push(line),
				clientFor: fakeClient,
			}),
		);

		// Exactly the pre-seeded job (unknown repo id) fails; the real "sync" job
		// for the configured repo (run against the fake, offline client)
		// succeeds. main() maps failed > 0 to exit code 1, so this is the
		// offline equivalent of that exit code.
		expect(failed).toBe(1);
		expect(failed > 0 ? 1 : 0).toBe(1);
		expect(
			lines.some(
				(line) =>
					line.includes("FAILED") &&
					line.includes("no-such-repo-id") &&
					line.includes("unknown repo"),
			),
		).toBe(true);
	});

	test("does not reprint a job failed by an earlier run", async () => {
		await writeConfig();
		const dbPath = defaultDbPath(home);

		// Seed a job that failed on some earlier, unrelated run: enqueue, claim,
		// then fail it directly, so it sits in the jobs table as history.
		const seeded = await migrateDatabase(dbPath);
		const seedQueue = new JobQueue(seeded.db);
		const stale = seedQueue.enqueue("analyse", "old-entry-id");
		if (!stale)
			throw new Error("setup failed: could not enqueue the stale job");
		const claimed = seedQueue.claim();
		if (!claimed)
			throw new Error("setup failed: could not claim the stale job");
		seedQueue.fail(claimed.id, "yesterday's error");
		seeded.db.close();

		const lines: string[] = [];
		const failed = await withTestToken(() =>
			runSync({
				home,
				concurrency: 1,
				log: (line) => lines.push(line),
				clientFor: fakeClient,
			}),
		);

		// A clean run must not resurrect history from the jobs table: no FAILED
		// line, and a zero failure count (what main() maps to exit code 0).
		expect(failed).toBe(0);
		expect(lines.some((line) => line.includes("FAILED"))).toBe(false);
	});
});

describe("runSync cancellation", () => {
	const TWO_REPOS = `hosts:
  - id: github
    api_base: https://api.github.com
    graphql: https://api.github.com/graphql
    token_env: NOTAM_TEST_TOKEN
repos:
  - host: github
    name: acme/first
  - host: github
    name: acme/second
`;

	/**
	 * A client whose listing blocks until aborted, so the first repository is
	 * genuinely mid-request when the interrupt arrives.
	 */
	function blockingClient(onEnter: () => void): GitHubClient {
		return {
			listMergedPRs: (_repo, options) => {
				const { signal } = options;
				return new Promise((_resolve, reject) => {
					// The listener goes on before the interrupt is announced: an
					// abort fired first would be missed entirely and this would
					// hang rather than fail.
					signal?.addEventListener("abort", () => reject(signal.reason));
					onEnter();
				});
			},
			fetchPRDetail: async () => {
				throw new Error("fetchPRDetail should not be called in this test");
			},
		};
	}

	test("stops the repository in flight and leaves the rest queued", async () => {
		await writeConfig(TWO_REPOS);
		const controller = new AbortController();
		const lines: string[] = [];
		const failed = await withTestToken(() =>
			runSync({
				home,
				concurrency: 1,
				log: (line) => lines.push(line),
				clientFor: () => blockingClient(() => controller.abort()),
				signal: controller.signal,
			}),
		);

		// One cancelled, one never claimed: not a success, so not exit code 0.
		expect(failed).toBe(1);
		expect(lines.some((line) => line.includes("Stopped: 1 cancelled"))).toBe(
			true,
		);
		expect(
			lines.some((line) => line.includes("1 still queued for the next run")),
		).toBe(true);
	});

	test("the queued repository survives for a later run to pick up", async () => {
		await writeConfig(TWO_REPOS);
		const controller = new AbortController();
		await withTestToken(() =>
			runSync({
				home,
				concurrency: 1,
				log: () => {},
				clientFor: () => blockingClient(() => controller.abort()),
				signal: controller.signal,
			}),
		);

		const reopened = await migrateDatabase(defaultDbPath(home));
		const queue = new JobQueue(reopened.db);
		expect(queue.count("queued")).toBe(1);
		expect(queue.count("cancelled")).toBe(1);
		reopened.db.close();
	});

	test("an uninterrupted run reports nothing about stopping", async () => {
		await writeConfig();
		const lines: string[] = [];
		const failed = await withTestToken(() =>
			runSync({
				home,
				concurrency: 1,
				log: (line) => lines.push(line),
				clientFor: fakeClient,
			}),
		);
		expect(failed).toBe(0);
		expect(lines.some((line) => line.includes("Stopped"))).toBe(false);
	});
});
