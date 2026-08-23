import { Hono } from "hono";
import { AnalysisStateSchema } from "../../shared/api.ts";
import { listEntries, listEntriesByState } from "../../store/entries.ts";
import { countRulesByEntryIds, listRulesByEntry } from "../../store/rules.ts";
import type { AppContext } from "../context.ts";
import { requireEntry, requireRepo } from "../lookup.ts";
import { matchesEntryQuery } from "../search.ts";
import { entryCounts, toEntryDetail, toEntrySummary } from "../serialise.ts";

export function entryRoutes(ctx: AppContext): Hono {
	const app = new Hono();

	app.get("/repos/:repoId/entries", (c) => {
		const repo = requireRepo(ctx.db, c.req.param("repoId"));
		const state = c.req.query("state");
		// A bad ?state= is the caller's mistake, so let the ZodError become a 400
		// rather than silently falling back to "all".
		const rows = state
			? listEntriesByState(ctx.db, repo.id, AnalysisStateSchema.parse(state))
			: listEntries(ctx.db, repo.id);
		const query = c.req.query("q") ?? "";
		const matched = rows.filter((entry) => matchesEntryQuery(entry, query));
		const ids = matched.map((entry) => entry.id);
		const ruleCounts = countRulesByEntryIds(ctx.db, ids);
		const draftCounts = countRulesByEntryIds(ctx.db, ids, "draft");
		return c.json({
			entries: matched.map((entry) =>
				toEntrySummary(
					entry,
					repo,
					ruleCounts[entry.id] ?? 0,
					draftCounts[entry.id] ?? 0,
				),
			),
			// Unfiltered on purpose: the chips show the whole picture even when
			// one of them is active.
			counts: entryCounts(ctx.db, repo.id),
		});
	});

	app.get("/entries/:entryId", (c) => {
		const entry = requireEntry(ctx.db, c.req.param("entryId"));
		const repo = requireRepo(ctx.db, entry.repo_id);
		return c.json(
			toEntryDetail(entry, repo, listRulesByEntry(ctx.db, entry.id)),
		);
	});

	return app;
}
