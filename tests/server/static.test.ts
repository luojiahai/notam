import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	createStaticHandler,
	loadAssetsFromDirectory,
} from "../../src/server/static.ts";
import { testContext } from "./helpers.ts";

const dirs: string[] = [];

async function fixtureDir(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "notam-assets-"));
	dirs.push(dir);
	await Bun.write(join(dir, "index.html"), "<div id=root></div>");
	await Bun.write(join(dir, "assets", "app-abc123.js"), "console.log(1)");
	await Bun.write(join(dir, "assets", "app-abc123.css"), "body{}");
	return dir;
}

afterAll(async () => {
	for (const dir of dirs) await rm(dir, { recursive: true, force: true });
});

describe("loadAssetsFromDirectory", () => {
	test("loads every file under its web-root path", async () => {
		const assets = await loadAssetsFromDirectory(await fixtureDir());
		expect([...assets.keys()].sort()).toEqual([
			"/assets/app-abc123.css",
			"/assets/app-abc123.js",
			"/index.html",
		]);
		expect(assets.get("/assets/app-abc123.js")?.contentType).toBe(
			"text/javascript; charset=utf-8",
		);
	});

	test("a missing directory is an empty source, not a crash", async () => {
		const assets = await loadAssetsFromDirectory("/definitely/not/here");
		expect(assets.size).toBe(0);
	});
});

describe("createStaticHandler", () => {
	test("serves index.html at the root and hashed assets immutably", async () => {
		const handler = createStaticHandler(
			await loadAssetsFromDirectory(await fixtureDir()),
		);
		const root = handler("/");
		expect(root?.status).toBe(200);
		expect(root?.headers.get("content-type")).toBe("text/html; charset=utf-8");
		expect(root?.headers.get("cache-control")).toBe("no-cache");
		expect(handler("/assets/app-abc123.js")?.headers.get("cache-control")).toBe(
			"public, max-age=31536000, immutable",
		);
	});

	test("an unknown extensionless path falls back to the SPA shell", async () => {
		const handler = createStaticHandler(
			await loadAssetsFromDirectory(await fixtureDir()),
		);
		const deep = handler("/repos/r_1/rules");
		expect(deep?.status).toBe(200);
		expect(await deep?.text()).toContain("id=root");
	});

	test("an unknown file with an extension is a miss, not the shell", async () => {
		const handler = createStaticHandler(
			await loadAssetsFromDirectory(await fixtureDir()),
		);
		expect(handler("/assets/gone.js")).toBeNull();
	});

	test("with no assets at all it explains how to build them", async () => {
		const handler = createStaticHandler(new Map());
		const response = handler("/");
		expect(response?.status).toBe(200);
		expect(await response?.text()).toContain("bun run build:web");
	});
});

describe("the app serves the SPA under the API", () => {
	test("/api still answers and / gets the shell", async () => {
		const harness = testContext();
		expect((await harness.app.request("/api/meta")).status).toBe(200);
		const root = await harness.app.request("/");
		expect(root.status).toBe(200);
		expect(root.headers.get("content-type")).toContain("text/html");
		harness.close();
	});
});
