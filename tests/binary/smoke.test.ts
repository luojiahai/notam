import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { defaultConfigPath } from "../../src/core/config/load.ts";
import { MetaSchema } from "../../src/shared/api.ts";
import { hostPlatform } from "../../src/shared/platform.ts";

const root = resolve(import.meta.dir, "..", "..");

const CONFIG = `hosts:
  - id: github
    api_base: https://api.github.com
    graphql: https://api.github.com/graphql
    token_env: NOTAM_BINARY_TEST_TOKEN

repos:
  - host: github
    name: acme/mono
    path_globs: []

analysis:
  concurrency: 1
  timeout_seconds: 30

server:
  port: 4317
`;

let outDir: string;
let home: string;
let binary: string;
const children: ReturnType<typeof Bun.spawn>[] = [];

async function run(command: string[]): Promise<void> {
	const proc = Bun.spawn(command, {
		cwd: root,
		stdout: "inherit",
		stderr: "inherit",
	});
	const code = await proc.exited;
	if (code !== 0) throw new Error(`${command.join(" ")} exited ${code}`);
}

/**
 * Asks the kernel for a port, then hands it to the child. The close is awaited
 * before the port is returned — an explicit `--port` does not auto-increment,
 * so handing over a socket that is still closing would fail the run outright.
 */
async function freePort(): Promise<number> {
	const server = Bun.serve({
		port: 0,
		hostname: "127.0.0.1",
		fetch: () => new Response(""),
	});
	// `Server["port"]` is typed `number | undefined` because Bun.serve's return
	// type also covers unix-socket listeners; a TCP listener like this one
	// always has one.
	const { port } = server;
	await server.stop(true);
	if (port === undefined) throw new Error("Bun.serve did not return a port");
	return port;
}

async function waitForServer(url: string): Promise<void> {
	for (let attempt = 0; attempt < 100; attempt++) {
		try {
			if ((await fetch(`${url}/api/meta`)).ok) return;
		} catch {
			// not up yet
		}
		await new Promise((done) => setTimeout(done, 100));
	}
	throw new Error(`${url} never came up`);
}

beforeAll(async () => {
	outDir = await mkdtemp(join(tmpdir(), "notam-binary-"));
	home = await mkdtemp(join(tmpdir(), "notam-binary-home-"));
	await Bun.write(defaultConfigPath(home), CONFIG);

	// Both builds run here rather than in a script, so `bun test tests/binary`
	// on its own is a complete instruction and cannot pass against a stale
	// web/dist from an earlier branch.
	await run(["bun", "run", "build:web"]);
	await run([
		"bun",
		"run",
		"scripts/build-binary.ts",
		"--version",
		"9.9.9-test",
		"--outdir",
		outDir,
	]);
	binary = join(outDir, `notam-${hostPlatform()}`);
}, 180_000);

afterAll(async () => {
	for (const child of children) child.kill("SIGTERM");
	if (outDir) await rm(outDir, { recursive: true, force: true });
	if (home) await rm(home, { recursive: true, force: true });
});

describe("the compiled binary", () => {
	test("prints the version defined at build time", async () => {
		const proc = Bun.spawn([binary, "version"], {
			stdout: "pipe",
			stderr: "inherit",
		});
		expect(await new Response(proc.stdout).text()).toBe("9.9.9-test\n");
		expect(await proc.exited).toBe(0);
	});

	test("serves the embedded single-page app with no web/dist in sight", async () => {
		const port = await freePort();
		const child = Bun.spawn([binary, "--port", String(port), "--no-open"], {
			// A curated environment. NOTAM_WEB_DIST is deliberately absent and the
			// working directory is not the repository, so a pass here can only mean
			// the assets came out of the binary itself.
			cwd: home,
			env: {
				PATH: process.env.PATH ?? "",
				HOME: home,
				NOTAM_HOME: home,
				NOTAM_BINARY_TEST_TOKEN: "t0ken",
			},
			stdout: "inherit",
			stderr: "inherit",
		});
		children.push(child);

		const baseUrl = `http://127.0.0.1:${port}`;
		await waitForServer(baseUrl);

		const meta = MetaSchema.parse(
			await (await fetch(`${baseUrl}/api/meta`)).json(),
		);
		expect(meta.version).toBe("9.9.9-test");

		const index = await fetch(`${baseUrl}/`);
		expect(index.status).toBe(200);
		expect(index.headers.get("content-type")).toBe("text/html; charset=utf-8");
		const html = await index.text();
		expect(html).toContain('<div id="root"></div>');
		expect(html).not.toContain("the web UI is not built");

		// The hashed bundle index.html names must be embedded too, and must come
		// back as JavaScript — a content type derived from the /$bunfs/ name
		// instead of the requested path is exactly the bug this catches.
		const script = html.match(/\/assets\/[^"]+\.js/)?.[0];
		expect(script).toBeDefined();
		const asset = await fetch(`${baseUrl}${script}`);
		expect(asset.status).toBe(200);
		expect(asset.headers.get("content-type")).toBe(
			"text/javascript; charset=utf-8",
		);
		expect(asset.headers.get("cache-control")).toBe(
			"public, max-age=31536000, immutable",
		);
		expect((await asset.text()).length).toBeGreaterThan(1000);
	}, 60_000);

	test("an explicit NOTAM_WEB_DIST beats the embedded copy, in the binary too", async () => {
		const marker =
			"<!doctype html><title>NOTAM_WEB_DIST MARKER, NOT THE REAL SPA</title>";
		const webDist = await mkdtemp(join(tmpdir(), "notam-binary-webdist-"));
		try {
			await Bun.write(join(webDist, "index.html"), marker);

			const port = await freePort();
			const child = Bun.spawn([binary, "--port", String(port), "--no-open"], {
				cwd: home,
				env: {
					PATH: process.env.PATH ?? "",
					HOME: home,
					NOTAM_HOME: home,
					NOTAM_BINARY_TEST_TOKEN: "t0ken",
					NOTAM_WEB_DIST: webDist,
				},
				stdout: "inherit",
				stderr: "inherit",
			});
			children.push(child);

			const baseUrl = `http://127.0.0.1:${port}`;
			await waitForServer(baseUrl);

			const index = await fetch(`${baseUrl}/`);
			expect(index.status).toBe(200);
			const html = await index.text();
			expect(html).toBe(marker);
			expect(html).not.toContain('<div id="root"></div>');
		} finally {
			await rm(webDist, { recursive: true, force: true });
		}
	}, 60_000);
});
