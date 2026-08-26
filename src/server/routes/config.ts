import { Hono } from "hono";
import { readConfig } from "../../core/config/load.ts";
import {
	purgeHost,
	purgeRepo,
	renameHost,
	renameRepo,
	updateConfig,
} from "../../core/config/update.ts";
import {
	type ConfigResponse,
	ConfigUpdateRequestSchema,
	RenameRequestSchema,
} from "../../shared/api.ts";
import { listArchivedHosts } from "../../store/hosts.ts";
import { listArchivedRepos, listRepos } from "../../store/repos.ts";
import type { AppContext } from "../context.ts";
import { requireAnyRepo, requireHost } from "../lookup.ts";
import {
	repoCost,
	toArchivedHost,
	toArchivedRepo,
	toConfigDocument,
} from "../serialise.ts";

/**
 * Reads config from disk rather than from `ctx.config`.
 *
 * The context holds the snapshot taken at boot, which is what the analysis
 * knobs and the bound port were built from and must stay. The settings surface
 * wants the file as it is now: it is small and local, and re-reading is what
 * makes an edit made in a text editor show up in the browser without a
 * restart.
 */
async function buildConfigResponse(ctx: AppContext): Promise<ConfigResponse> {
	const { config, hash } = await readConfig(ctx.configPath);
	return {
		config: toConfigDocument(config),
		hash,
		path: ctx.configPath,
		status: {
			hosts: config.hosts.map((host) => ({
				id: host.id,
				token_env: host.token_env,
				// The name and whether it is set, never the value.
				token_present: Boolean(ctx.env[host.token_env]),
			})),
			archived_hosts: listArchivedHosts(ctx.db).map(toArchivedHost),
			archived_repos: listArchivedRepos(ctx.db).map((repo) =>
				toArchivedRepo(ctx.db, repo),
			),
			costs: Object.fromEntries(
				listRepos(ctx.db).map((repo) => [repo.id, repoCost(ctx.db, repo.id)]),
			),
		},
	};
}

export function configRoutes(ctx: AppContext): Hono {
	const app = new Hono();

	app.get("/config", async (c) => c.json(await buildConfigResponse(ctx)));

	app.put("/config", async (c) => {
		const body = ConfigUpdateRequestSchema.parse(await c.req.json());
		await updateConfig({
			db: ctx.db,
			path: ctx.configPath,
			home: ctx.home,
			now: ctx.now(),
			next: body.config,
			expectedHash: body.hash,
		});
		return c.json(await buildConfigResponse(ctx));
	});

	app.post("/repos/:repoId/rename", async (c) => {
		const repo = requireAnyRepo(ctx.db, c.req.param("repoId"));
		const body = RenameRequestSchema.parse(await c.req.json());
		await renameRepo({
			db: ctx.db,
			path: ctx.configPath,
			id: repo.id,
			next: body.name,
			expectedHash: body.hash,
			now: ctx.now(),
		});
		return c.json(await buildConfigResponse(ctx));
	});

	app.post("/hosts/:hostId/rename", async (c) => {
		const host = requireHost(ctx.db, c.req.param("hostId"));
		const body = RenameRequestSchema.parse(await c.req.json());
		await renameHost({
			db: ctx.db,
			path: ctx.configPath,
			id: host.id,
			next: body.name,
			expectedHash: body.hash,
			now: ctx.now(),
		});
		return c.json(await buildConfigResponse(ctx));
	});

	// Purge, not archive. Archiving is what removing an entry from the document
	// already does, so it needs no route of its own; this is the one that
	// destroys, and it only accepts something already archived.
	app.delete("/repos/:repoId", async (c) => {
		const repo = requireAnyRepo(ctx.db, c.req.param("repoId"));
		purgeRepo(ctx.db, repo.id);
		return c.json(await buildConfigResponse(ctx));
	});

	app.delete("/hosts/:hostId", async (c) => {
		const host = requireHost(ctx.db, c.req.param("hostId"));
		purgeHost(ctx.db, host.id);
		return c.json(await buildConfigResponse(ctx));
	});

	app.post("/hosts/:hostId/test", async (c) => {
		const host = requireHost(ctx.db, c.req.param("hostId"));
		return c.json(await ctx.testHost(host));
	});

	return app;
}
