import { Hono } from "hono";
import { listRepos } from "../../store/repos.ts";
import type { AppContext } from "../context.ts";
import { requireHost } from "../lookup.ts";
import { toRepoSummary } from "../serialise.ts";

export function repoRoutes(ctx: AppContext): Hono {
	const app = new Hono();

	app.get("/repos", (c) =>
		c.json(
			listRepos(ctx.db).map((repo) =>
				toRepoSummary(ctx.db, repo, requireHost(ctx.db, repo.host_id)),
			),
		),
	);

	return app;
}
