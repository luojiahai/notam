import { Hono } from "hono";
import type { Meta } from "../../shared/api.ts";
import type { AppContext } from "../context.ts";

export function buildMeta(ctx: AppContext): Meta {
	return {
		version: ctx.version,
		config_path: ctx.configPath,
		db_path: ctx.dbPath,
		claude_available: ctx.claudeAvailable,
		warnings: ctx.warnings,
		analysis: {
			concurrency: ctx.config.analysis.concurrency,
			timeout_seconds: ctx.config.analysis.timeout_seconds,
			model: ctx.config.analysis.model ?? null,
		},
	};
}

export function metaRoutes(ctx: AppContext): Hono {
	const app = new Hono();
	app.get("/meta", (c) => c.json(buildMeta(ctx)));
	return app;
}
