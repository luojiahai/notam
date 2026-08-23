import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInit } from "../../src/cli/init.ts";
import { startServer } from "../../src/cli/run.ts";
import {
	ConfigError,
	defaultConfigPath,
	defaultDbPath,
} from "../../src/core/config/load.ts";
import { JobQueue } from "../../src/jobs/queue.ts";
import { MetaSchema, RepoSummarySchema } from "../../src/shared/api.ts";
import { migrateDatabase } from "../../src/store/migrations.ts";

const homes: string[] = [];

const CONFIG = `hosts:
  - id: github
    api_base: https://api.github.com
    graphql: https://api.github.com/graphql
    token_env: NOTAM_RUN_TEST_TOKEN

repos:
  - host: github
    name: acme/mono
    path_globs: ["services/payments/**"]

analysis:
  concurrency: 2
  timeout_seconds: 45

server:
  port: 4317
`;

async function tempHome(config: string = CONFIG): Promise<string> {
	const home = await mkdtemp(join(tmpdir(), "notam-run-"));
	homes.push(home);
	await runInit({ home, force: true, log: () => {} });
	await Bun.write(defaultConfigPath(home), config);
	return home;
}

afterAll(async () => {
	for (const home of homes) await rm(home, { recursive: true, force: true });
});

const env = { ...process.env, NOTAM_RUN_TEST_TOKEN: "t0ken" };

describe("startServer", () => {
	test("serves the API against a freshly migrated database", async () => {
		const home = await tempHome();
		const opened: string[] = [];
		const server = await startServer({
			home,
			port: 0,
			open: false,
			env,
			log: () => {},
			openBrowser: (url) => opened.push(url),
		});
		try {
			const meta = MetaSchema.parse(
				await (await fetch(`${server.url}/api/meta`)).json(),
			);
			expect(meta.config_path).toBe(defaultConfigPath(home));
			expect(meta.analysis.timeout_seconds).toBe(45);
			expect(meta.analysis.concurrency).toBe(2);

			const repos = (await (
				await fetch(`${server.url}/api/repos`)
			).json()) as unknown[];
			expect(RepoSummarySchema.parse(repos[0]).name).toBe("acme/mono");

			// --no-open must not launch anything.
			expect(opened).toEqual([]);
		} finally {
			await server.stop();
		}
	});

	test("opens the browser when asked", async () => {
		const home = await tempHome();
		const opened: string[] = [];
		const server = await startServer({
			home,
			port: 0,
			open: true,
			env,
			log: () => {},
			openBrowser: (url) => opened.push(url),
		});
		try {
			expect(opened).toEqual([server.url]);
		} finally {
			await server.stop();
		}
	});

	test("serves the placeholder page when the SPA has not been built", async () => {
		const home = await tempHome();
		const server = await startServer({
			home,
			port: 0,
			open: false,
			env: { ...env, NOTAM_WEB_DIST: join(home, "no-such-dist") },
			log: () => {},
			openBrowser: () => {},
		});
		try {
			const body = await (await fetch(`${server.url}/`)).text();
			expect(body).toContain("bun run build:web");
		} finally {
			await server.stop();
		}
	});

	test("refuses to start when a token environment variable is missing", async () => {
		const home = await tempHome();
		// A fixed port, not an ephemeral one: the point of the test is that the
		// refusal happens *before* anything is bound or written, and port 0 could
		// not tell that apart from a refusal issued after a successful bind.
		const promise = startServer({
			home,
			port: 4399,
			open: false,
			env: { ...process.env, NOTAM_RUN_TEST_TOKEN: undefined },
			log: () => {},
			openBrowser: () => {},
		});
		await expect(promise).rejects.toThrow("NOTAM_RUN_TEST_TOKEN");
		await expect(fetch("http://127.0.0.1:4399/api/meta")).rejects.toThrow();
		expect(await Bun.file(defaultDbPath(home)).exists()).toBe(false);
	});

	test("refuses to start on an invalid config, naming the offending path", async () => {
		const home = await tempHome("hosts: []\nrepos: []\n");
		const promise = startServer({
			home,
			port: 0,
			open: false,
			env,
			log: () => {},
			openBrowser: () => {},
		});
		await expect(promise).rejects.toBeInstanceOf(ConfigError);
		await expect(promise).rejects.toThrow("hosts");
	});

	test("warns rather than refusing when the claude CLI is missing", async () => {
		const home = await tempHome();
		const server = await startServer({
			home,
			port: 0,
			open: false,
			// An empty PATH makes Bun.which("claude") fail deterministically.
			env: { ...env, PATH: "" },
			log: () => {},
			openBrowser: () => {},
		});
		try {
			const meta = MetaSchema.parse(
				await (await fetch(`${server.url}/api/meta`)).json(),
			);
			expect(meta.claude_available).toBe(false);
			expect(meta.warnings.join(" ")).toContain("claude");
		} finally {
			await server.stop();
		}
	});

	test("resumes a job left running by a previous process", async () => {
		const home = await tempHome();

		// Seed the state a Ctrl-C mid-analysis leaves behind: a claimed job stuck
		// in `running` with no process behind it. The entry id names nothing, so
		// the handler fails on its own unknown-entry guard — a terminal state
		// reached with no `claude` subprocess and no network.
		const seeded = await migrateDatabase(defaultDbPath(home));
		const seedQueue = new JobQueue(seeded.db);
		const enqueued = seedQueue.enqueue("analyse", "no-such-entry-id");
		if (!enqueued) throw new Error("setup failed: could not enqueue the job");
		const claimed = seedQueue.claim();
		if (!claimed) throw new Error("setup failed: could not claim the job");
		expect(claimed.state).toBe("running");
		seeded.db.close();

		const lines: string[] = [];
		const server = await startServer({
			home,
			port: 0,
			open: false,
			env,
			log: (line) => lines.push(line),
			openBrowser: () => {},
		});
		try {
			// No route is called: booting alone must have kicked the runner.
			await server.ctx.analyseRunner.idle();
			expect(server.ctx.queue.get(claimed.id)?.state).toBe("failed");
			expect(server.ctx.queue.count("queued")).toBe(0);
			expect(lines.join("\n")).toContain("Reclaimed 1 job(s)");
		} finally {
			await server.stop();
		}
	});

	test("fails loudly when an explicit port is already taken", async () => {
		const first = await startServer({
			home: await tempHome(),
			port: 0,
			open: false,
			env,
			log: () => {},
			openBrowser: () => {},
		});
		try {
			// An explicit --port must never answer on a different one, so the
			// second start fails rather than silently landing on first.port + 1.
			const promise = startServer({
				home: await tempHome(),
				port: first.port,
				open: false,
				env,
				log: () => {},
				openBrowser: () => {},
			});
			await expect(promise).rejects.toThrow(String(first.port));
		} finally {
			await first.stop();
		}
	});
});
