import { Hono } from "hono";
import type { SyncCancelled, SyncStarted } from "../../shared/api.ts";
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

	/**
	 * Stopping something that is not running is a no-op, not a 404: by the time
	 * a click reaches the server the sync it meant to stop may have finished on
	 * its own, and that is not an error the user needs to see.
	 */
	app.post("/repos/:repoId/sync/cancel", (c) => {
		const repo = requireRepo(ctx.db, c.req.param("repoId"));
		const response: SyncCancelled = {
			cancelled: ctx.syncRunner.cancelPending("sync", repo.id),
		};
		return c.json(response);
	});

	return app;
}
