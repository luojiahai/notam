import { Hono } from "hono";
import type { AppContext } from "./context.ts";
import { errorResponse, HttpError, statusFor } from "./errors.ts";
import { entryRoutes } from "./routes/entries.ts";
import { eventRoutes } from "./routes/events.ts";
import { metaRoutes } from "./routes/meta.ts";
import { promotionRoutes } from "./routes/promotions.ts";
import { repoRoutes } from "./routes/repos.ts";
import { ruleRoutes } from "./routes/rules.ts";
import { syncRoutes } from "./routes/sync.ts";
import { type AssetSource, createStaticHandler } from "./static.ts";

/**
 * The hostnames this server answers to.
 *
 * Binding 127.0.0.1 keeps the network off the port; it does not keep a
 * *browser* off it. A page on evil.com whose DNS re-resolves to 127.0.0.1 is
 * same-origin as far as the browser is concerned, and there is no
 * authentication layer behind this — it could read private pull request bodies
 * from /api/entries/:id, abandon rules, or open a pull request in the team's
 * repository. Rejecting a foreign Host is the standard defence against DNS
 * rebinding, and cross-origin POSTs are already dead at the preflight for want
 * of CORS headers.
 *
 * Only the hostname is checked, not the port. The port a request carries is
 * whatever the attacker's page typed; the port it *arrived* on is the one this
 * process bound, and it is not in question. Checking the hostname alone is the
 * whole defence, and it means the guard needs nothing threaded in from
 * `startServer` that a call site could forget to pass.
 */
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

export function isLoopbackHost(host: string | undefined): boolean {
	if (host === undefined || host === "") return false;
	// `[::1]:8787` keeps its brackets; `127.0.0.1:8787` splits on the colon.
	const hostname = host.startsWith("[")
		? host.slice(0, host.indexOf("]") + 1)
		: (host.split(":")[0] ?? "");
	return LOOPBACK_HOSTS.has(hostname.toLowerCase());
}

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
	app.onError((error) => {
		// The terminal the user started is this server's only console, and this
		// handler replaces Hono's own logging default, so without this line an
		// unexpected failure leaves no trace anywhere. Only the unmapped kind is
		// logged: a 502 from GitHub or a 409 from an illegal transition is a
		// known outcome the response already carries verbatim.
		if (statusFor(error) === 500) console.error(error);
		return errorResponse(error);
	});
	// Registered before the routes so it wraps all of them, the SSE stream and
	// the static handler included.
	app.use("*", async (c, next) => {
		// Bun derives `request.url` from the Host header, so the fallback is the
		// same value by another name; it is there for a client that sends none.
		const host = c.req.header("host") ?? new URL(c.req.url).host;
		if (!isLoopbackHost(host)) {
			throw new HttpError(
				403,
				`Refusing a request for host "${host}": notam answers on 127.0.0.1 and localhost only.`,
			);
		}
		await next();
	});
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
