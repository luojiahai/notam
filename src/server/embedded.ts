import { type AssetSource, contentTypeFor } from "./static.ts";

/** One embedded file: its web-root path, and the path `Bun.file` reads it from. */
export type EmbeddedAsset = { path: string; file: string };

/**
 * Filled exactly once, by the `build/entry.ts` that `scripts/build-binary.ts`
 * generates and compiles.
 *
 * Module-level state is the price of the seam. `bun build --compile` embeds a
 * file only when some module *statically* imports it with
 * `with { type: "file" }`, and the file names are Vite's content hashes, which
 * are not known until Vite has run. So the entrypoint is generated, and this is
 * where it hands its imports over. Nothing else writes it, and running from a
 * source checkout leaves it empty.
 */
let registered: EmbeddedAsset[] = [];

export function registerEmbeddedAssets(assets: EmbeddedAsset[]): void {
	registered = assets;
}

export function hasEmbeddedAssets(): boolean {
	return registered.length > 0;
}

/**
 * The content type comes from the *web* path, not from the embedded one.
 * Inside a compiled binary `Bun.file` reads `/$bunfs/root/index-x63esczm.html`,
 * a name Bun invents; the path the browser asked for is the authority.
 */
export async function loadEmbeddedAssets(): Promise<AssetSource> {
	const assets: AssetSource = new Map();
	for (const { path, file } of registered) {
		assets.set(path, {
			contentType: contentTypeFor(path),
			bytes: await Bun.file(file).arrayBuffer(),
		});
	}
	return assets;
}
