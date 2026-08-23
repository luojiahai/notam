import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	hasEmbeddedAssets,
	loadEmbeddedAssets,
	registerEmbeddedAssets,
} from "../../src/server/embedded.ts";

const dirs: string[] = [];

/**
 * The fixture files are deliberately named without extensions. Inside a
 * compiled binary the embedded path is `/$bunfs/root/index-x63esczm.html` —
 * a name Bun invents — so anything that types an asset from the file it reads
 * rather than the path the browser asked for would be wrong there and pass
 * here. Extensionless fixtures make that mistake fail.
 */
async function fixture(): Promise<{ html: string; js: string }> {
	const dir = await mkdtemp(join(tmpdir(), "notam-embedded-"));
	dirs.push(dir);
	const html = join(dir, "blob0");
	const js = join(dir, "blob1");
	await Bun.write(html, "<div id=root></div>");
	await Bun.write(js, "console.log(1)");
	return { html, js };
}

afterEach(() => registerEmbeddedAssets([]));

afterAll(async () => {
	for (const dir of dirs) await rm(dir, { recursive: true, force: true });
});

describe("the embedded asset registry", () => {
	test("is empty until an entrypoint registers", () => {
		expect(hasEmbeddedAssets()).toBe(false);
	});

	test("reads each registered file and types it from its web path", async () => {
		const { html, js } = await fixture();
		registerEmbeddedAssets([
			{ path: "/index.html", file: html },
			{ path: "/assets/app-abc123.js", file: js },
		]);

		expect(hasEmbeddedAssets()).toBe(true);
		const assets = await loadEmbeddedAssets();
		expect([...assets.keys()].sort()).toEqual([
			"/assets/app-abc123.js",
			"/index.html",
		]);
		expect(assets.get("/index.html")?.contentType).toBe(
			"text/html; charset=utf-8",
		);
		expect(assets.get("/assets/app-abc123.js")?.contentType).toBe(
			"text/javascript; charset=utf-8",
		);
		expect(new TextDecoder().decode(assets.get("/index.html")?.bytes)).toBe(
			"<div id=root></div>",
		);
	});
});
