import { describe, expect, test } from "bun:test";
import type { PromotionSummary } from "../../src/shared/api.ts";
import {
	filterPromotions,
	matchesPromotionQuery,
	promotionCounts,
} from "../../web/src/lib/promotions.ts";

function promotion(
	overrides: Partial<PromotionSummary> = {},
): PromotionSummary {
	return {
		id: "pm_1",
		repo_id: "r_1",
		branch: "notam/rules-20260823-abc123",
		pr_number: 900,
		pr_url: "https://github.com/acme/mono/pull/900",
		state: "open",
		created_at: "2026-08-23T09:00:00.000Z",
		last_checked_at: null,
		rule_count: 2,
		...overrides,
	};
}

describe("promotionCounts", () => {
	test("counts every state, including the ones with no rows", () => {
		expect(
			promotionCounts([
				promotion({ id: "pm_1", state: "open" }),
				promotion({ id: "pm_2", state: "open" }),
				promotion({ id: "pm_3", state: "merged" }),
			]),
		).toEqual({ open: 2, merged: 1, closed: 0 });
	});

	test("an empty list still names all three states", () => {
		// The chips are rendered from these keys, so a missing one would take a
		// filter off the screen rather than show it at zero.
		expect(promotionCounts([])).toEqual({ open: 0, merged: 0, closed: 0 });
	});
});

describe("matchesPromotionQuery", () => {
	test("an empty query matches everything", () => {
		expect(matchesPromotionQuery(promotion(), "")).toBe(true);
		expect(matchesPromotionQuery(promotion(), "   ")).toBe(true);
	});

	test("matches part of the branch, whatever the case", () => {
		expect(matchesPromotionQuery(promotion(), "abc123")).toBe(true);
		expect(matchesPromotionQuery(promotion(), "NOTAM/rules")).toBe(true);
		expect(matchesPromotionQuery(promotion(), "trunk")).toBe(false);
	});

	test("matches the pull request number, with or without the hash", () => {
		expect(matchesPromotionQuery(promotion(), "900")).toBe(true);
		expect(matchesPromotionQuery(promotion(), "#900")).toBe(true);
		expect(matchesPromotionQuery(promotion(), "#901")).toBe(false);
	});

	/**
	 * The hash comes off before anything is compared. Matching it against the
	 * number alone would let a lone "#" read as "only the ones with a pull
	 * request" — a filter nobody asked for and the box cannot show.
	 */
	test("a hash on its own narrows to nothing, like an empty query", () => {
		expect(matchesPromotionQuery(promotion(), "#")).toBe(true);
		expect(
			matchesPromotionQuery(promotion({ pr_number: null, pr_url: null }), "#"),
		).toBe(true);
	});

	test("a promotion with no pull request is still searchable by branch", () => {
		const branchOnly = promotion({ pr_number: null, pr_url: null });
		expect(matchesPromotionQuery(branchOnly, "abc123")).toBe(true);
		expect(matchesPromotionQuery(branchOnly, "900")).toBe(false);
	});
});

describe("filterPromotions", () => {
	const open = promotion({ id: "pm_1", state: "open" });
	const merged = promotion({
		id: "pm_2",
		state: "merged",
		branch: "notam/rules-20260601-zzz999",
		pr_number: 812,
	});

	test("keeps everything when neither the chip nor the box is set", () => {
		expect(filterPromotions([open, merged], "", "")).toEqual([open, merged]);
	});

	test("a chip and a query narrow together, not in turn", () => {
		expect(filterPromotions([open, merged], "merged", "812")).toEqual([merged]);
		expect(filterPromotions([open, merged], "merged", "900")).toEqual([]);
	});

	test("leaves the server's order alone", () => {
		// Newest first is what the list arrives in, and a row that reordered
		// itself as its state changed would move under the pointer.
		expect(filterPromotions([merged, open], "", "").map((p) => p.id)).toEqual([
			"pm_2",
			"pm_1",
		]);
	});
});
