import { Hono } from "hono";
import type { SyncStarted } from "../../shared/api.ts";
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
		// Annotated, so drift from the shared wire schema is a compile error here
		// rather than a parse failure in the browser.
		const response: SyncStarted = {
			job_id: job?.id ?? null,
			already_running: job === null,
		};
		return c.json(response);
	});

	return app;
}
