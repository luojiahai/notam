import type {
	PromotionState,
	PromotionSummary,
} from "../../../src/shared/api.ts";

/** One tally per lifecycle state, for the filter chips. */
export type PromotionCounts = Record<PromotionState, number>;

/** Every state, always, so a chip never disappears at zero. */
export function promotionCounts(
	promotions: PromotionSummary[],
): PromotionCounts {
	const counts: PromotionCounts = { open: 0, merged: 0, closed: 0 };
	for (const promotion of promotions) counts[promotion.state] += 1;
	return counts;
}

/**
 * The filter box's predicate: branch text or pull request number.
 *
 * The leading `#` comes off before anything is compared, so the number can be
 * typed the way the table displays it — and so a lone `#` narrows to nothing
 * rather than quietly hiding every promotion that has no pull request yet.
 */
export function matchesPromotionQuery(
	promotion: PromotionSummary,
	query: string,
): boolean {
	const needle = query.trim().replace(/^#/, "").toLowerCase();
	if (needle === "") return true;
	if (promotion.branch.toLowerCase().includes(needle)) return true;
	return (
		promotion.pr_number !== null && String(promotion.pr_number).includes(needle)
	);
}

/**
 * The rows a chip and a filter box leave standing.
 *
 * Narrowing happens in the browser rather than through query parameters the
 * way entries and rules do, because `GET /repos/:repoId/promotions` returns a
 * repository's promotions whole — there is nothing to page through, and
 * nothing for the server to filter that the client is not already holding.
 */
export function filterPromotions(
	promotions: PromotionSummary[],
	state: PromotionState | "",
	query: string,
): PromotionSummary[] {
	return promotions.filter(
		(promotion) =>
			(state === "" || promotion.state === state) &&
			matchesPromotionQuery(promotion, query),
	);
}
