import { Hono } from "hono";
import type { AppContext } from "../context.ts";
import { sseResponse } from "../sse.ts";

export function eventRoutes(ctx: AppContext): Hono {
	const app = new Hono();
	app.get("/events", (c) =>
		sseResponse(ctx.bus, {
			version: ctx.version,
			signal: c.req.raw.signal,
		}),
	);
	return app;
}
