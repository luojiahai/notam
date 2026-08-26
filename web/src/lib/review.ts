import type { PromotionSummary, RuleSummary } from "../../../src/shared/api.ts";

export type PromotionGroup = {
	promotion: PromotionSummary;
	rules: RuleSummary[];
};

/**
 * A proposed rule and the pull request carrying it, joined in the browser.
 *
 * `promotion_id` rides on every rule summary and the promotions route returns
 * a repository's promotions whole, so the join costs no extra request and no
 * server change — which is what keeps this out of `core/` where it would be
 * business logic and out of `server/` where it would not belong at all.
 *
 * Only open promotions get a group. A merged one's rules are verified and a
 * closed one's are back in draft, so neither has anything left in review; both
 * are listed by `settledPromotions` instead. A group with no rules is still
 * returned rather than dropped: a pull request whose rules were all abandoned
 * is exactly the case the reader needs to see, because it is still open and
 * still theirs to close.
 */
export function groupByPromotion(
	promotions: PromotionSummary[],
	rules: RuleSummary[],
): PromotionGroup[] {
	const byPromotion = new Map<string, RuleSummary[]>();
	for (const rule of rules) {
		if (rule.promotion_id === null) continue;
		const bucket = byPromotion.get(rule.promotion_id);
		if (bucket) bucket.push(rule);
		else byPromotion.set(rule.promotion_id, [rule]);
	}
	return (
		promotions
			.filter((promotion) => promotion.state === "open")
			// Newest first: an open promotion is a thing you are waiting on, and the
			// one you opened last is the one you are waiting on now.
			.sort((a, b) => b.created_at.localeCompare(a.created_at))
			.map((promotion) => ({
				promotion,
				rules: byPromotion.get(promotion.id) ?? [],
			}))
	);
}

/** Everything that has already landed or been closed, newest first. */
export function settledPromotions(
	promotions: PromotionSummary[],
): PromotionSummary[] {
	return promotions
		.filter((promotion) => promotion.state !== "open")
		.sort((a, b) => b.created_at.localeCompare(a.created_at));
}
