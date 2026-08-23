import { Hono } from "hono";
import { planPromotion, promoteRules } from "../../core/promotion/index.ts";
import { refreshPromotions } from "../../core/promotion/refresh.ts";
import {
	PromotionRequestSchema,
	RefreshRequestSchema,
} from "../../shared/api.ts";
import { listPromotions } from "../../store/promotions.ts";
import {
	countRulesByPromotionIds,
	listRulesByPromotion,
} from "../../store/rules.ts";
import { readBody } from "../body.ts";
import type { AppContext } from "../context.ts";
import { requirePromotion, requireRepo } from "../lookup.ts";
import {
	toPromotionPlanView,
	toPromotionSummary,
	toRefreshSummaryView,
} from "../serialise.ts";

export function promotionRoutes(ctx: AppContext): Hono {
	const app = new Hono();

	app.get("/repos/:repoId/promotions", (c) => {
		const repo = requireRepo(ctx.db, c.req.param("repoId"));
		const promotions = listPromotions(ctx.db, repo.id);
		const counts = countRulesByPromotionIds(
			ctx.db,
			promotions.map((promotion) => promotion.id),
		);
		return c.json(
			promotions.map((promotion) =>
				toPromotionSummary(promotion, counts[promotion.id] ?? 0),
			),
		);
	});

	/** Read-only pre-flight: this is what the confirmation dialog renders. */
	app.post("/promotions/plan", async (c) => {
		const body = await readBody(c, PromotionRequestSchema);
		const plan = await planPromotion(ctx.promotionDeps, body.rule_ids);
		return c.json(toPromotionPlanView(plan));
	});

	/**
	 * Deliberately re-plans server-side from the rule ids rather than accepting
	 * the plan the dialog was showing. The plan carries file *contents*; letting
	 * a client post those back would make the browser the author of what gets
	 * committed to the team's repository. The cost is one extra
	 * `listRuleFiles` call, which is also the freshest possible collision check.
	 *
	 * This is the one route that does slow outbound work inside the request. It
	 * has to: its result is what the user is waiting to see, and a job would
	 * only move the waiting somewhere less visible.
	 */
	app.post("/promotions", async (c) => {
		const body = await readBody(c, PromotionRequestSchema);
		const plan = await planPromotion(ctx.promotionDeps, body.rule_ids);
		const promotion = await promoteRules(ctx.promotionDeps, plan, {
			title: body.title,
		});
		ctx.bus.publish({
			type: "promotion",
			repo_id: promotion.repo_id,
			promotion_id: promotion.id,
			state: promotion.state,
		});
		ctx.bus.publish({ type: "rules", repo_id: promotion.repo_id });
		return c.json(
			toPromotionSummary(
				promotion,
				listRulesByPromotion(ctx.db, promotion.id).length,
			),
		);
	});

	/** Runs on app open and on the manual button. */
	app.post("/promotions/refresh", async (c) => {
		const body = await readBody(c, RefreshRequestSchema);
		const summary = await refreshPromotions(ctx.promotionDeps, {
			repoId: body.repo_id,
			onProgress: (event) => {
				const promotion = requirePromotion(ctx.db, event.promotionId);
				ctx.bus.publish({
					type: "promotion",
					repo_id: promotion.repo_id,
					promotion_id: promotion.id,
					state: event.state,
				});
			},
		});
		if (summary.returnedToDraft > 0) {
			for (const repo of new Set(
				listPromotions(ctx.db).map((promotion) => promotion.repo_id),
			)) {
				ctx.bus.publish({ type: "rules", repo_id: repo });
			}
		}
		return c.json(toRefreshSummaryView(summary));
	});

	return app;
}
