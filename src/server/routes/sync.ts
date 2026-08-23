import { Hono } from "hono";
import type { AppContext } from "../context.ts";
import { requireRepo } from "../lookup.ts";

export function syncRoutes(ctx: AppContext): Hono {
	const app = new Hono();

	/**
	 * Enqueue and return. The job table's partial unique index means a second
	 * press while one is pending is reported, not duplicated — that is what
	 * `enqueue` returning null means.
	 */
	app.post("/repos/:repoId/sync", (c) => {
		const repo = requireRepo(ctx.db, c.req.param("repoId"));
		const job = ctx.queue.enqueue("sync", repo.id);
		ctx.syncRunner.kick();
		return c.json({ job_id: job?.id ?? null, already_running: job === null });
	});

	return app;
}
