import { Hono } from "hono";
import type { AppContext } from "./context.ts";
import { errorResponse, HttpError } from "./errors.ts";
import { entryRoutes } from "./routes/entries.ts";
import { metaRoutes } from "./routes/meta.ts";
import { repoRoutes } from "./routes/repos.ts";
import { syncRoutes } from "./routes/sync.ts";

/**
 * The whole HTTP surface. Routers are mounted under `/api`; later tasks add
 * more of them and the static SPA handler underneath.
 *
 * There is no business logic in this tree. A route resolves the context, calls
 * a function plans 1 and 2 exported, serialises, and returns.
 */
export function createApp(ctx: AppContext): Hono {
	const api = new Hono();
	api.route("/", metaRoutes(ctx));
	api.route("/", repoRoutes(ctx));
	api.route("/", entryRoutes(ctx));
	api.route("/", syncRoutes(ctx));

	const app = new Hono();
	app.onError((error) => errorResponse(error));
	app.route("/api", api);
	// A mounted sub-app's own notFound is not consulted, so the JSON 404 has to
	// live on the parent. Task 9 replaces this handler with one that tries the
	// SPA assets first and falls back to exactly this response.
	app.notFound((c) =>
		errorResponse(
			new HttpError(
				404,
				`No route for ${c.req.method} ${new URL(c.req.url).pathname}`,
			),
		),
	);
	return app;
}
