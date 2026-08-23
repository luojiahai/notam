import type { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { EntryRow, NewRule, RepoRow } from "../../src/shared/types.ts";
import { insertPromotion } from "../../src/store/promotions.ts";
import {
	countRulesByEntryIds,
	countRulesByPromotionIds,
	countRulesByStatus,
	deleteDraftRulesForEntry,
	getRule,
	insertRules,
	listRules,
	listRulesByEntry,
	listRulesByIds,
	listRulesByPromotion,
	updateRuleStatus,
} from "../../src/store/rules.ts";
import { SEED_NOW, seedDatabase } from "../helpers/seed.ts";

function newRule(overrides: Partial<NewRule> = {}): NewRule {
	return {
		kind: "do",
		directive: "Always add a regression test alongside a bug fix.",
		rationale: "Reviewers blocked payment fixes that shipped without one.",
		scope_globs: ["services/payments/**"],
		confidence: 0.9,
		source_comment_urls: [
			"https://github.com/acme/mono/pull/4821#discussion_r1",
		],
		file_slug: "always-add-a-regression-test-alongside-a-bug-fix",
		...overrides,
	};
}

let db: Database;
let repo: RepoRow;
let entry: EntryRow;

beforeEach(() => {
	const seeded = seedDatabase();
	db = seeded.db;
	repo = seeded.repo;
	entry = seeded.entry;
});
afterEach(() => db.close());

describe("insertRules", () => {
	test("inserts drafts with ru_ ids and JSON-decoded arrays", () => {
		const [rule] = insertRules(db, repo.id, entry.id, [newRule()], SEED_NOW);
		if (!rule) throw new Error("no rule inserted");
		expect(rule.id.startsWith("ru_")).toBe(true);
		expect(rule.status).toBe("draft");
		expect(rule.promotion_id).toBeNull();
		expect(rule.scope_globs).toEqual(["services/payments/**"]);
		expect(rule.source_comment_urls).toEqual([
			"https://github.com/acme/mono/pull/4821#discussion_r1",
		]);
		expect(rule.confidence).toBe(0.9);
		expect(rule.created_at).toBe(SEED_NOW.toISOString());
		expect(rule.status_changed_at).toBe(SEED_NOW.toISOString());
	});

	test("inserts several rules in one call and returns them in order", () => {
		const rows = insertRules(
			db,
			repo.id,
			entry.id,
			[
				newRule({ directive: "A", file_slug: "a" }),
				newRule({ directive: "B", file_slug: "b", kind: "dont" }),
			],
			SEED_NOW,
		);
		expect(rows.map((r) => r.directive)).toEqual(["A", "B"]);
		expect(rows.map((r) => r.kind)).toEqual(["do", "dont"]);
	});

	test("inserting an empty list is a no-op", () => {
		expect(insertRules(db, repo.id, entry.id, [], SEED_NOW)).toEqual([]);
		expect(listRulesByEntry(db, entry.id)).toEqual([]);
	});
});

describe("reads", () => {
	// Two separate inserts with distinct timestamps: rules created in the same
	// millisecond would order by their random id suffix, and this block asserts
	// on order.
	beforeEach(() => {
		insertRules(
			db,
			repo.id,
			entry.id,
			[newRule({ directive: "Zebra first", file_slug: "zebra" })],
			SEED_NOW,
		);
		insertRules(
			db,
			repo.id,
			entry.id,
			[newRule({ directive: "Apple second", file_slug: "apple" })],
			new Date("2026-08-24T09:00:00.000Z"),
		);
	});

	test("getRule round-trips and returns null for an unknown id", () => {
		const rules = listRulesByEntry(db, entry.id);
		const first = rules[0];
		if (!first) throw new Error("no rules");
		expect(getRule(db, first.id)).toEqual(first);
		expect(getRule(db, "ru_nope")).toBeNull();
	});

	test("listRules defaults to newest-created first", () => {
		expect(listRules(db, repo.id).map((r) => r.directive)).toEqual([
			"Apple second",
			"Zebra first",
		]);
	});

	test("listRules sorts by directive on request — the manual substitute for clustering", () => {
		expect(
			listRules(db, repo.id, { orderBy: "directive" }).map((r) => r.directive),
		).toEqual(["Apple second", "Zebra first"]);
	});

	test("listRules filters by status", () => {
		const rules = listRules(db, repo.id);
		const first = rules[0];
		if (!first) throw new Error("no rules");
		updateRuleStatus(
			db,
			first.id,
			"abandoned",
			undefined,
			SEED_NOW.toISOString(),
		);
		expect(listRules(db, repo.id, { status: "draft" })).toHaveLength(1);
		expect(listRules(db, repo.id, { status: "abandoned" })).toHaveLength(1);
		expect(listRules(db, repo.id, { status: "verified" })).toHaveLength(0);
	});

	test("listRulesByIds returns only the requested rules, in a stable order", () => {
		const all = listRules(db, repo.id, { orderBy: "directive" });
		const ids = all.map((r) => r.id);
		const picked = listRulesByIds(db, [ids[1] as string, ids[0] as string]);
		expect(picked).toHaveLength(2);
		// Stable by creation, not by the order the caller happened to pass.
		expect(picked.map((r) => r.directive)).toEqual([
			"Zebra first",
			"Apple second",
		]);
	});

	test("listRulesByIds with an empty list returns an empty list", () => {
		expect(listRulesByIds(db, [])).toEqual([]);
	});

	test("countRulesByStatus zero-fills every status", () => {
		expect(countRulesByStatus(db, repo.id)).toEqual({
			draft: 2,
			proposed: 0,
			verified: 0,
			abandoned: 0,
		});
	});
});

describe("updateRuleStatus", () => {
	test("sets the status, the promotion link, and the change time", () => {
		const promotion = insertPromotion(
			db,
			{ repo_id: repo.id, branch: "notam/rules-a", pr_number: 7, pr_url: "u" },
			SEED_NOW,
		);
		const [rule] = insertRules(db, repo.id, entry.id, [newRule()], SEED_NOW);
		if (!rule) throw new Error("no rule");

		expect(
			updateRuleStatus(
				db,
				rule.id,
				"proposed",
				promotion.id,
				"2026-08-24T00:00:00.000Z",
			),
		).toBe(true);
		const proposed = getRule(db, rule.id);
		expect(proposed?.status).toBe("proposed");
		expect(proposed?.promotion_id).toBe(promotion.id);
		expect(proposed?.status_changed_at).toBe("2026-08-24T00:00:00.000Z");
		expect(listRulesByPromotion(db, promotion.id).map((r) => r.id)).toEqual([
			rule.id,
		]);
	});

	test("an undefined promotionId leaves the existing link alone", () => {
		const promotion = insertPromotion(
			db,
			{ repo_id: repo.id, branch: "notam/rules-a", pr_number: 7, pr_url: "u" },
			SEED_NOW,
		);
		const [rule] = insertRules(db, repo.id, entry.id, [newRule()], SEED_NOW);
		if (!rule) throw new Error("no rule");
		updateRuleStatus(
			db,
			rule.id,
			"proposed",
			promotion.id,
			SEED_NOW.toISOString(),
		);
		updateRuleStatus(
			db,
			rule.id,
			"verified",
			undefined,
			SEED_NOW.toISOString(),
		);
		expect(getRule(db, rule.id)?.promotion_id).toBe(promotion.id);
	});

	test("an explicit null promotionId clears the link", () => {
		const promotion = insertPromotion(
			db,
			{ repo_id: repo.id, branch: "notam/rules-a", pr_number: 7, pr_url: "u" },
			SEED_NOW,
		);
		const [rule] = insertRules(db, repo.id, entry.id, [newRule()], SEED_NOW);
		if (!rule) throw new Error("no rule");
		updateRuleStatus(
			db,
			rule.id,
			"proposed",
			promotion.id,
			SEED_NOW.toISOString(),
		);
		updateRuleStatus(db, rule.id, "draft", null, SEED_NOW.toISOString());
		expect(getRule(db, rule.id)?.promotion_id).toBeNull();
	});

	test("reports false for an unknown id", () => {
		expect(
			updateRuleStatus(db, "ru_nope", "draft", null, SEED_NOW.toISOString()),
		).toBe(false);
	});
});

describe("deleteDraftRulesForEntry", () => {
	test("removes drafts and keeps every other status", () => {
		const rows = insertRules(
			db,
			repo.id,
			entry.id,
			[
				newRule({ directive: "draft one", file_slug: "d1" }),
				newRule({ directive: "proposed one", file_slug: "d2" }),
				newRule({ directive: "verified one", file_slug: "d3" }),
				newRule({ directive: "abandoned one", file_slug: "d4" }),
			],
			SEED_NOW,
		);
		const [, proposed, verified, abandoned] = rows;
		if (!proposed || !verified || !abandoned) throw new Error("missing rules");
		updateRuleStatus(db, proposed.id, "proposed", null, SEED_NOW.toISOString());
		updateRuleStatus(db, verified.id, "verified", null, SEED_NOW.toISOString());
		updateRuleStatus(
			db,
			abandoned.id,
			"abandoned",
			null,
			SEED_NOW.toISOString(),
		);

		expect(deleteDraftRulesForEntry(db, entry.id)).toBe(1);
		expect(
			listRulesByEntry(db, entry.id)
				.map((r) => r.status)
				.sort(),
		).toEqual(["abandoned", "proposed", "verified"]);
	});

	test("returns 0 when the entry has no drafts", () => {
		expect(deleteDraftRulesForEntry(db, entry.id)).toBe(0);
	});
});

describe("batched rule counts", () => {
	test("countRulesByEntryIds zero-fills every id it was asked about", () => {
		insertRules(
			db,
			repo.id,
			entry.id,
			[
				{
					kind: "do",
					directive: "Add a test.",
					rationale: "Because.",
					scope_globs: [],
					confidence: 0.9,
					source_comment_urls: [],
					file_slug: "add-a-test",
				},
			],
			SEED_NOW,
		);
		expect(countRulesByEntryIds(db, [entry.id, "e_none"])).toEqual({
			[entry.id]: 1,
			e_none: 0,
		});
		expect(countRulesByEntryIds(db, [entry.id], "draft")).toEqual({
			[entry.id]: 1,
		});
		expect(countRulesByEntryIds(db, [entry.id], "verified")).toEqual({
			[entry.id]: 0,
		});
		expect(countRulesByEntryIds(db, [])).toEqual({});
	});

	test("countRulesByPromotionIds counts only linked rules", () => {
		expect(countRulesByPromotionIds(db, ["pm_1"])).toEqual({ pm_1: 0 });
	});
});
