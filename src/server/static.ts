import { readdir } from "node:fs/promises";
import { dirname, extname, join } from "node:path";

export type StaticAsset = { contentType: string; bytes: ArrayBuffer };

/**
 * Web-root path (`/index.html`, `/assets/app-abc123.js`) to bytes.
 *
 * This Map *is* the seam the embedded SPA needs: one producer reads a
 * directory on disk, another reads the same entries out of a
 * `bun build --compile` binary, and nothing downstream of this type changes.
 */
export type AssetSource = Map<string, StaticAsset>;

const CONTENT_TYPES: Record<string, string> = {
	".css": "text/css; charset=utf-8",
	".html": "text/html; charset=utf-8",
	".ico": "image/x-icon",
	".js": "text/javascript; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".map": "application/json; charset=utf-8",
	".png": "image/png",
	".svg": "image/svg+xml",
	".webmanifest": "application/manifest+json",
	".woff": "font/woff",
	".woff2": "font/woff2",
};

export function contentTypeFor(path: string): string {
	return (
		CONTENT_TYPES[extname(path).toLowerCase()] ?? "application/octet-stream"
	);
}

/** `NOTAM_WEB_DIST` overrides it; otherwise it is `web/dist` beside `src/`. */
export function defaultWebDistPath(
	env: Record<string, string | undefined> = process.env,
): string {
	return (
		env.NOTAM_WEB_DIST ?? join(dirname(import.meta.dir), "..", "web", "dist")
	);
}

/**
 * Every file under `dir`, as sorted web-root paths (`/index.html`).
 *
 * Sorted because `scripts/build-binary.ts` renders a generated module from
 * this list, and a generated file whose line order depends on readdir order is
 * a diff that changes for no reason.
 */
export async function listAssetPaths(dir: string): Promise<string[]> {
	let names: string[];
	try {
		names = await readdir(dir, { recursive: true });
	} catch {
		// A checkout that has never run `bun run build:web` is a normal state,
		// not an error. createStaticHandler renders a page saying so.
		return [];
	}
	const paths: string[] = [];
	for (const name of names) {
		// readdir(recursive) yields directories too; Bun.file on one is not
		// readable, and `exists()` is false for it.
		if (!(await Bun.file(join(dir, name)).exists())) continue;
		paths.push(`/${name.split("\\").join("/")}`);
	}
	return paths.sort();
}

export async function loadAssetsFromDirectory(
	dir: string,
): Promise<AssetSource> {
	const assets: AssetSource = new Map();
	for (const path of await listAssetPaths(dir)) {
		assets.set(path, {
			contentType: contentTypeFor(path),
			bytes: await Bun.file(join(dir, path.slice(1))).arrayBuffer(),
		});
	}
	return assets;
}

export const MISSING_SPA_HTML = `<!doctype html>
<meta charset="utf-8">
<title>NOTAM — the web UI is not built</title>
<body style="font:16px/1.6 system-ui;margin:4rem auto;max-width:40rem">
<h1>The NOTAM web UI is not built yet</h1>
<p>The REST API under <code>/api</code> is running. To build the single-page app:</p>
<pre style="background:#f4f4f5;padding:1rem;border-radius:.5rem">bun run build:web</pre>
<p>Then reload this page.</p>
</body>`;

/**
 * Vite emits content-hashed file names under `/assets/`, so those are safe to
 * cache forever; `index.html` names them and must never be cached.
 */
function cacheControlFor(path: string): string {
	return path.startsWith("/assets/")
		? "public, max-age=31536000, immutable"
		: "no-cache";
}

function respond(path: string, asset: StaticAsset): Response {
	return new Response(asset.bytes, {
		headers: {
			"content-type": asset.contentType,
			"cache-control": cacheControlFor(path),
		},
	});
}

/**
 * Returns null for a genuine miss so the caller can produce its own 404.
 *
 * An extensionless path that misses is a client-side route, not a missing file,
 * and gets the SPA shell. A path with an extension that misses is a real 404 —
 * answering a stale `/assets/app-old.js` with HTML would show the user a syntax
 * error instead of a cache problem.
 */
export function createStaticHandler(
	assets: AssetSource,
): (pathname: string) => Response | null {
	return (pathname: string) => {
		const path = pathname === "/" ? "/index.html" : pathname;
		const asset = assets.get(path);
		if (asset) return respond(path, asset);
		// Check the extension of the *original* request, not the rewritten
		// index.html path: "/" itself has no extension and must always fall
		// through to the shell, even when index.html is missing from `assets`.
		if (extname(pathname) !== "") return null;

		const shell = assets.get("/index.html");
		if (shell) return respond("/index.html", shell);
		return new Response(MISSING_SPA_HTML, {
			headers: {
				"content-type": "text/html; charset=utf-8",
				"cache-control": "no-cache",
			},
		});
	};
}
