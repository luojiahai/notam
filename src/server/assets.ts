import { hasEmbeddedAssets, loadEmbeddedAssets } from "./embedded.ts";
import {
	type AssetSource,
	defaultWebDistPath,
	loadAssetsFromDirectory,
} from "./static.ts";

/**
 * Picks the single-page app this process serves. The order is the whole of
 * plan 4's contribution to the server:
 *
 * 1. An explicit `NOTAM_WEB_DIST` always wins. It is what `bun run dev:web` and
 *    the Playwright end-to-end point at, and an override a binary could
 *    silently ignore would be worse than no override at all.
 * 2. Otherwise the copy compiled into the binary, when there is one.
 * 3. Otherwise `web/dist` beside the source tree — running from a checkout.
 *
 * A compiled binary has no source tree, so step 3 finds nothing there and
 * `createStaticHandler` renders its "not built" page. Step 2 is what stops that
 * from ever being what a released binary shows.
 */
export async function resolveAssets(
	env: Record<string, string | undefined> = process.env,
): Promise<AssetSource> {
	if (env.NOTAM_WEB_DIST) return loadAssetsFromDirectory(env.NOTAM_WEB_DIST);
	if (hasEmbeddedAssets()) return loadEmbeddedAssets();
	return loadAssetsFromDirectory(defaultWebDistPath(env));
}
