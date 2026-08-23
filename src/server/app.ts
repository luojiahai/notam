import { Hono } from "hono";
import type { AppContext } from "./context.ts";
import { errorResponse, HttpError } from "./errors.ts";
import { entryRoutes } from "./routes/entries.ts";
import { eventRoutes } from "./routes/events.ts";
import { metaRoutes } from "./routes/meta.ts";
import { promotionRoutes } from "./routes/promotions.ts";
import { repoRoutes } from "./routes/repos.ts";
import { ruleRoutes } from "./routes/rules.ts";
import { syncRoutes } from "./routes/sync.ts";
import { type AssetSource, createStaticHandler } from "./static.ts";

/**
 * The whole HTTP surface. Routers are mounted under `/api`; the static SPA
 * handler answers everything else.
 *
 * There is no business logic in this tree. A route resolves the context, calls
 * a function plans 1 and 2 exported, serialises, and returns.
 */
export function createApp(
	ctx: AppContext,
	assets: AssetSource = new Map(),
): Hono {
	const api = new Hono();
	api.route("/", metaRoutes(ctx));
	api.route("/", repoRoutes(ctx));
	api.route("/", entryRoutes(ctx));
	api.route("/", ruleRoutes(ctx));
	api.route("/", syncRoutes(ctx));
	api.route("/", promotionRoutes(ctx));
	api.route("/", eventRoutes(ctx));

	const app = new Hono();
	app.onError((error) => errorResponse(error));
	app.route("/api", api);
	const serveStatic = createStaticHandler(assets);
	// Registered as notFound rather than as a `GET *` route so it can never
	// shadow an API path: anything under /api that matched nothing already
	// produced its own response.
	app.notFound((c) => {
		const { pathname } = new URL(c.req.url);
		if (c.req.method === "GET" && !pathname.startsWith("/api/")) {
			const response = serveStatic(pathname);
			if (response) return response;
		}
		return errorResponse(
			new HttpError(404, `No route for ${c.req.method} ${pathname}`),
		);
	});
	return app;
}
