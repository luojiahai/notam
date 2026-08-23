import { Hono } from "hono";
import { transitionRules } from "../../core/rules/state.ts";
import { RuleStatusRequestSchema, RuleStatusSchema } from "../../shared/api.ts";
import { listRules, listRulesByIds } from "../../store/rules.ts";
import { readBody } from "../body.ts";
import type { AppContext } from "../context.ts";
import { requireEntry, requireRepo, requireRule } from "../lookup.ts";
import { matchesRuleQuery } from "../search.ts";
import { ruleCounts, toRuleDetail, toRuleSummaries } from "../serialise.ts";

export function ruleRoutes(ctx: AppContext): Hono {
	const app = new Hono();

	app.get("/repos/:repoId/rules", (c) => {
		const repo = requireRepo(ctx.db, c.req.param("repoId"));
		const status = c.req.query("status");
		// Spec section 9: sorting by directive is the manual substitute for the
		// clustering v1 cut, so it is a first-class query parameter.
		const orderBy =
			c.req.query("sort") === "directive" ? "directive" : "created";
		const rows = listRules(ctx.db, repo.id, {
			status: status ? RuleStatusSchema.parse(status) : undefined,
			orderBy,
		});
		const query = c.req.query("q") ?? "";
		const matched = rows.filter((rule) => matchesRuleQuery(rule, query));
		return c.json({
			rules: toRuleSummaries(ctx.db, matched),
			counts: ruleCounts(ctx.db, repo.id),
		});
	});

	app.get("/rules/:ruleId", (c) => {
		const rule = requireRule(ctx.db, c.req.param("ruleId"));
		return c.json(toRuleDetail(rule, requireEntry(ctx.db, rule.entry_id)));
	});

	/**
	 * "Abandon" and "Mark verified", and nothing else. The legality of the move
	 * is decided by core/rules/state.ts — an illegal one throws
	 * RuleTransitionError, which the error mapper turns into a 409 and which
	 * rolls the whole selection back, so a mixed batch is all-or-nothing.
	 */
	app.post("/rules/status", async (c) => {
		const body = await readBody(c, RuleStatusRequestSchema);
		// Validate the whole selection before moving any of it, the way
		// /entries/analyse does, and let `requireRule` own the 404 envelope so
		// there is only ever one copy of ApiErrorSchema's shape.
		for (const id of body.rule_ids) requireRule(ctx.db, id);
		const rules = listRulesByIds(ctx.db, body.rule_ids);
		const updated = transitionRules(
			ctx.db,
			rules.map((rule) => rule.id),
			body.status,
			ctx.now(),
		);
		for (const repoId of new Set(updated.map((rule) => rule.repo_id))) {
			ctx.bus.publish({ type: "rules", repo_id: repoId });
		}
		return c.json(toRuleSummaries(ctx.db, updated));
	});

	return app;
}
