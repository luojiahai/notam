import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveAssets } from "../../src/server/assets.ts";
import { registerEmbeddedAssets } from "../../src/server/embedded.ts";
import {
	defaultWebDistPath,
	loadAssetsFromDirectory,
} from "../../src/server/static.ts";

const dirs: string[] = [];

async function distDir(marker: string): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "notam-resolve-"));
	dirs.push(dir);
	await Bun.write(join(dir, "index.html"), marker);
	return dir;
}

afterEach(() => registerEmbeddedAssets([]));

afterAll(async () => {
	for (const dir of dirs) await rm(dir, { recursive: true, force: true });
});

describe("resolveAssets", () => {
	test("an explicit NOTAM_WEB_DIST beats the embedded copy", async () => {
		const dir = await distDir("from the directory");
		const embedded = await distDir("from the binary");
		registerEmbeddedAssets([
			{ path: "/index.html", file: join(embedded, "index.html") },
		]);

		const assets = await resolveAssets({ NOTAM_WEB_DIST: dir });
		expect(new TextDecoder().decode(assets.get("/index.html")?.bytes)).toBe(
			"from the directory",
		);
	});

	test("uses the embedded copy when nothing overrides it", async () => {
		const embedded = await distDir("from the binary");
		registerEmbeddedAssets([
			{ path: "/index.html", file: join(embedded, "index.html") },
		]);

		const assets = await resolveAssets({});
		expect(new TextDecoder().decode(assets.get("/index.html")?.bytes)).toBe(
			"from the binary",
		);
	});

	test("falls back to web/dist beside the source tree", async () => {
		// Pins the fallback *target*, not its contents: a checkout that has never
		// run `bun run build:web` has an empty web/dist, and that is a legal
		// state — createStaticHandler renders its "not built" page for it.
		const assets = await resolveAssets({});
		const expected = await loadAssetsFromDirectory(defaultWebDistPath({}));
		expect([...assets.keys()].sort()).toEqual([...expected.keys()].sort());
	});
});
