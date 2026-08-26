import { describe, expect, test } from "bun:test";
import type { PromotionSummary, RuleSummary } from "../../src/shared/api.ts";
import {
	groupByPromotion,
	settledPromotions,
} from "../../web/src/lib/review.ts";

function promotion(
	overrides: Partial<PromotionSummary> = {},
): PromotionSummary {
	return {
		id: "pm_1",
		repo_id: "r_1",
		branch: "notam/rules-2026-08-25",
		pr_number: 4830,
		pr_url: "https://github.com/acme/mono/pull/4830",
		state: "open",
		created_at: "2026-08-25T15:00:00.000Z",
		last_checked_at: null,
		rule_count: 1,
		...overrides,
	};
}

function rule(overrides: Partial<RuleSummary> = {}): RuleSummary {
	return {
		id: "ru_1",
		repo_id: "r_1",
		entry_id: "e_1",
		type: "testing",
		directive: "Always add a regression test alongside a bug fix.",
		rationale: "Reviewers repeatedly blocked untested payment fixes.",
		scope_globs: ["services/payments/**"],
		confidence: 0.9,
		source_comment_urls: [],
		status: "proposed",
		promotion_id: "pm_1",
		file_slug: "always-add-a-regression-test",
		created_at: "2026-08-23T09:00:00.000Z",
		status_changed_at: "2026-08-25T15:00:00.000Z",
		source_number: 4821,
		source_url: "https://github.com/acme/mono/pull/4821",
		...overrides,
	};
}

describe("groupByPromotion", () => {
	test("files each rule under the promotion carrying it", () => {
		const groups = groupByPromotion(
			[promotion(), promotion({ id: "pm_2", pr_number: 4831 })],
			[rule(), rule({ id: "ru_2", promotion_id: "pm_2" })],
		);
		expect(groups.map((group) => group.promotion.id)).toEqual(["pm_1", "pm_2"]);
		expect(groups[0]?.rules.map((entry) => entry.id)).toEqual(["ru_1"]);
		expect(groups[1]?.rules.map((entry) => entry.id)).toEqual(["ru_2"]);
	});

	test("orders open promotions newest first", () => {
		const groups = groupByPromotion(
			[
				promotion({ id: "pm_old", created_at: "2026-08-01T00:00:00.000Z" }),
				promotion({ id: "pm_new", created_at: "2026-08-25T00:00:00.000Z" }),
			],
			[],
		);
		expect(groups.map((group) => group.promotion.id)).toEqual([
			"pm_new",
			"pm_old",
		]);
	});

	test("leaves out promotions that have already settled", () => {
		const groups = groupByPromotion(
			[
				promotion(),
				promotion({ id: "pm_merged", state: "merged" }),
				promotion({ id: "pm_closed", state: "closed" }),
			],
			[],
		);
		expect(groups.map((group) => group.promotion.id)).toEqual(["pm_1"]);
	});

	/**
	 * An open pull request every one of whose rules was abandoned is exactly the
	 * case the reader has to see: it is still open on the host, and closing it is
	 * still their job. Dropping empty groups would hide it.
	 */
	test("keeps an open promotion that has no rules left riding in it", () => {
		const groups = groupByPromotion([promotion()], []);
		expect(groups).toHaveLength(1);
		expect(groups[0]?.rules).toEqual([]);
	});

	test("ignores a rule that is linked to no promotion", () => {
		const groups = groupByPromotion(
			[promotion()],
			[rule({ id: "ru_loose", status: "draft", promotion_id: null })],
		);
		expect(groups[0]?.rules).toEqual([]);
	});
});

describe("settledPromotions", () => {
	test("returns merged and closed promotions, newest first", () => {
		const settled = settledPromotions([
			promotion(),
			promotion({
				id: "pm_merged",
				state: "merged",
				created_at: "2026-08-18T00:00:00.000Z",
			}),
			promotion({
				id: "pm_closed",
				state: "closed",
				created_at: "2026-08-20T00:00:00.000Z",
			}),
		]);
		expect(settled.map((entry) => entry.id)).toEqual([
			"pm_closed",
			"pm_merged",
		]);
	});
});
