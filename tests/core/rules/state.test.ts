import type { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	canTransition,
	LEGAL_TRANSITIONS,
	RuleTransitionError,
	transitionRule,
	transitionRules,
} from "../../../src/core/rules/state.ts";
import type {
	EntryRow,
	NewRule,
	RepoRow,
	RuleStatus,
} from "../../../src/shared/types.ts";
import { insertPromotion } from "../../../src/store/promotions.ts";
import { getRule, insertRules } from "../../../src/store/rules.ts";
import { SEED_NOW, seedDatabase } from "../../helpers/seed.ts";

const LATER = new Date("2026-08-24T09:00:00.000Z");

function newRule(overrides: Partial<NewRule> = {}): NewRule {
	return {
		kind: "do",
		directive: "Always add a regression test alongside a bug fix.",
		rationale: "Because reviewers keep asking for one.",
		scope_globs: [],
		confidence: 0.9,
		source_comment_urls: [],
		file_slug: "always-add-a-regression-test",
		...overrides,
	};
}

let db: Database;
let repo: RepoRow;
let entry: EntryRow;
let promotionId: string;

beforeEach(() => {
	const seeded = seedDatabase();
	db = seeded.db;
	repo = seeded.repo;
	entry = seeded.entry;
	promotionId = insertPromotion(
		db,
		{ repo_id: repo.id, branch: "notam/rules-a", pr_number: 7, pr_url: "u" },
		SEED_NOW,
	).id;
});
afterEach(() => db.close());

function draft(overrides: Partial<NewRule> = {}) {
	const [rule] = insertRules(
		db,
		repo.id,
		entry.id,
		[newRule(overrides)],
		SEED_NOW,
	);
	if (!rule) throw new Error("no rule inserted");
	return rule;
}

describe("the transition table", () => {
	test("allows exactly the legal edges and no others", () => {
		expect(LEGAL_TRANSITIONS).toEqual({
			draft: ["proposed", "abandoned"],
			proposed: ["draft", "verified", "abandoned"],
			verified: ["abandoned"],
			abandoned: [],
		});
	});

	test("canTransition agrees with the table, and refuses a no-op", () => {
		expect(canTransition("draft", "proposed")).toBe(true);
		expect(canTransition("draft", "verified")).toBe(false);
		expect(canTransition("verified", "draft")).toBe(false);
		expect(canTransition("abandoned", "draft")).toBe(false);
		expect(canTransition("draft", "draft")).toBe(false);
	});

	test("abandoned is reachable from every other state", () => {
		const states: RuleStatus[] = ["draft", "proposed", "verified"];
		for (const from of states)
			expect(canTransition(from, "abandoned")).toBe(true);
	});
});

describe("transitionRule", () => {
	test("draft -> proposed links the promotion and stamps the change time", () => {
		const rule = draft();
		const after = transitionRule(db, rule.id, "proposed", LATER, {
			promotionId,
		});
		expect(after.status).toBe("proposed");
		expect(after.promotion_id).toBe(promotionId);
		expect(after.status_changed_at).toBe(LATER.toISOString());
	});

	test("draft -> proposed without a promotion id is refused", () => {
		const rule = draft();
		expect(() => transitionRule(db, rule.id, "proposed", LATER)).toThrow(
			RuleTransitionError,
		);
		expect(getRule(db, rule.id)?.status).toBe("draft");
	});

	test("proposed -> draft clears the promotion link", () => {
		const rule = draft();
		transitionRule(db, rule.id, "proposed", LATER, { promotionId });
		const after = transitionRule(db, rule.id, "draft", LATER);
		expect(after.status).toBe("draft");
		expect(after.promotion_id).toBeNull();
	});

	test("proposed -> verified keeps the promotion link as provenance", () => {
		const rule = draft();
		transitionRule(db, rule.id, "proposed", LATER, { promotionId });
		const after = transitionRule(db, rule.id, "verified", LATER);
		expect(after.status).toBe("verified");
		expect(after.promotion_id).toBe(promotionId);
	});

	test("an illegal transition throws and changes nothing", () => {
		const rule = draft();
		expect(() => transitionRule(db, rule.id, "verified", LATER)).toThrow(
			/draft.*verified/,
		);
		const unchanged = getRule(db, rule.id);
		expect(unchanged?.status).toBe("draft");
		expect(unchanged?.status_changed_at).toBe(SEED_NOW.toISOString());
	});

	test("abandoned is terminal", () => {
		const rule = draft();
		transitionRule(db, rule.id, "abandoned", LATER);
		expect(() => transitionRule(db, rule.id, "draft", LATER)).toThrow(
			RuleTransitionError,
		);
	});

	test("an unknown rule id throws", () => {
		expect(() => transitionRule(db, "ru_nope", "abandoned", LATER)).toThrow(
			/ru_nope/,
		);
	});
});

describe("transitionRules", () => {
	test("moves every rule in one transaction", () => {
		const a = draft({ directive: "A", file_slug: "a" });
		const b = draft({ directive: "B", file_slug: "b" });
		const moved = transitionRules(db, [a.id, b.id], "proposed", LATER, {
			promotionId,
		});
		expect(moved.map((r) => r.status)).toEqual(["proposed", "proposed"]);
	});

	test("one illegal rule rolls the whole batch back", () => {
		const a = draft({ directive: "A", file_slug: "a" });
		const b = draft({ directive: "B", file_slug: "b" });
		transitionRule(db, b.id, "abandoned", LATER);

		expect(() =>
			transitionRules(db, [a.id, b.id], "proposed", LATER, { promotionId }),
		).toThrow(RuleTransitionError);
		// a must not have moved: a half-promoted selection is exactly the
		// half-committed state promotion forbids.
		expect(getRule(db, a.id)?.status).toBe("draft");
	});

	test("an empty list is a no-op", () => {
		expect(transitionRules(db, [], "abandoned", LATER)).toEqual([]);
	});
});
