import { Hono } from "hono";
import {
	cancelEntries,
	cancelRepoEntries,
	queueEntries,
} from "../../core/analysis/index.ts";
import {
	AnalyseRequestSchema,
	AnalysisStateSchema,
	type CancelResult,
	type EntriesResponse,
	type RepoAnalyseCancelled,
} from "../../shared/api.ts";
import { listEntries, listEntriesByState } from "../../store/entries.ts";
import { countRulesByEntryIds, listRulesByEntry } from "../../store/rules.ts";
import { readBody } from "../body.ts";
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
		// Annotated, so drift from the shared wire schema is a compile error here
		// rather than a parse failure in the browser.
		const response: EntriesResponse = {
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
		};
		return c.json(response);
	});

	app.get("/entries/:entryId", (c) => {
		const entry = requireEntry(ctx.db, c.req.param("entryId"));
		const repo = requireRepo(ctx.db, entry.repo_id);
		return c.json(
			toEntryDetail(entry, repo, listRulesByEntry(ctx.db, entry.id)),
		);
	});

	/**
	 * The row action, the panel action, and the multi-select bulk action are
	 * all this one call: all three enqueue one job per entry, and giving them
	 * one endpoint is what keeps that true.
	 */
	app.post("/entries/analyse", async (c) => {
		const body = await readBody(c, AnalyseRequestSchema);
		// Validate the whole selection before queueing any of it, so a typo in
		// one id cannot leave half a batch running.
		for (const id of body.entry_ids) requireEntry(ctx.db, id);
		const result = queueEntries(ctx.db, ctx.queue, body.entry_ids);
		ctx.analyseRunner.kick();
		return c.json(result);
	});

	/**
	 * The same body as /entries/analyse, validated the same way: two endpoints
	 * that take one selection should refuse the same selections. An entry with
	 * nothing pending comes back `skipped` rather than as an error — by the
	 * time a click lands the work may have finished on its own.
	 */
	app.post("/entries/analyse/cancel", async (c) => {
		const body = await readBody(c, AnalyseRequestSchema);
		for (const id of body.entry_ids) requireEntry(ctx.db, id);
		const response: CancelResult = cancelEntries(
			ctx.db,
			cancellerFor(ctx),
			body.entry_ids,
			ctx.analysisProgress,
		);
		return c.json(response);
	});

	app.post("/repos/:repoId/analyse/cancel", (c) => {
		const repo = requireRepo(ctx.db, c.req.param("repoId"));
		const response: RepoAnalyseCancelled = cancelRepoEntries(
			ctx.db,
			cancellerFor(ctx),
			repo.id,
			ctx.analysisProgress,
		);
		return c.json(response);
	});

	return app;
}

/** An entry id is an analyse job's target, so the pending index resolves it. */
function cancellerFor(ctx: AppContext) {
	return (entryId: string) =>
		ctx.analyseRunner.cancelPending("analyse", entryId);
}
