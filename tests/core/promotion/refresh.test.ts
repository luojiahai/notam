import type { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { GitHubError } from "../../../src/core/github/client.ts";
import type { GitDataClient } from "../../../src/core/github/types.ts";
import type { PromotionDeps } from "../../../src/core/promotion/index.ts";
import { refreshPromotions } from "../../../src/core/promotion/refresh.ts";
import {
	transitionRule,
	transitionRules,
} from "../../../src/core/rules/state.ts";
import type {
	EntryRow,
	HostRow,
	NewRule,
	PromotionState,
	RepoRow,
} from "../../../src/shared/types.ts";
import {
	getPromotion,
	insertPromotion,
	listPromotions,
} from "../../../src/store/promotions.ts";
import { getRule, insertRules } from "../../../src/store/rules.ts";
import { SEED_NOW, seedDatabase } from "../../helpers/seed.ts";

const CHECKED = new Date("2026-08-25T12:00:00.000Z");

function newRule(overrides: Partial<NewRule> = {}): NewRule {
	return {
		kind: "do",
		directive: "Always add a regression test alongside a bug fix.",
		rationale: "Reviewers kept asking.",
		scope_globs: [],
		confidence: 0.9,
		source_comment_urls: [],
		file_slug: "always-add-a-test",
		...overrides,
	};
}

/** Answers with a per-PR-number state, or throws for a number in `fail`. */
function fakeClient(
	states: Record<number, PromotionState>,
	fail: Record<number, Error> = {},
): GitDataClient & { checked: number[] } {
	const checked: number[] = [];
	return {
		checked,
		async listRuleFiles(): Promise<string[]> {
			return [];
		},
		async createPRWithFiles(): Promise<never> {
			throw new Error("refresh must never create a pull request");
		},
		async getPRState(_repo, number): Promise<PromotionState> {
			checked.push(number);
			const failure = fail[number];
			if (failure) throw failure;
			return states[number] ?? "open";
		},
	};
}

let db: Database;
let repo: RepoRow;
let entry: EntryRow;

function deps(client: GitDataClient): PromotionDeps {
	return {
		db,
		clientFor: (_host: HostRow) => client,
		now: () => CHECKED,
	};
}

beforeEach(() => {
	const seeded = seedDatabase();
	db = seeded.db;
	repo = seeded.repo;
	entry = seeded.entry;
});
afterEach(() => db.close());

/** An open promotion with `count` proposed rules attached. */
function proposedPromotion(prNumber: number, count = 1) {
	const promotion = insertPromotion(
		db,
		{
			repo_id: repo.id,
			branch: `notam/rules-${prNumber}`,
			pr_number: prNumber,
			pr_url: `https://github.com/acme/mono/pull/${prNumber}`,
		},
		SEED_NOW,
	);
	const rules = insertRules(
		db,
		repo.id,
		entry.id,
		Array.from({ length: count }, (_, i) =>
			newRule({
				directive: `rule ${prNumber}-${i}`,
				file_slug: `r-${prNumber}-${i}`,
			}),
		),
		SEED_NOW,
	);
	transitionRules(
		db,
		rules.map((r) => r.id),
		"proposed",
		SEED_NOW,
		{ promotionId: promotion.id },
	);
	return { promotion, rules };
}

describe("refreshPromotions", () => {
	test("marks a merged promotion merged and leaves its rules proposed", async () => {
		const { promotion, rules } = proposedPromotion(10);
		const summary = await refreshPromotions(deps(fakeClient({ 10: "merged" })));

		expect(summary.checked).toBe(1);
		expect(summary.merged).toBe(1);
		expect(summary.returnedToDraft).toBe(0);
		const after = getPromotion(db, promotion.id);
		expect(after?.state).toBe("merged");
		expect(after?.last_checked_at).toBe(CHECKED.toISOString());
		// Verification is always a manual decision.
		expect(getRule(db, rules[0]?.id as string)?.status).toBe("proposed");
		expect(getRule(db, rules[0]?.id as string)?.promotion_id).toBe(
			promotion.id,
		);
	});

	test("returns the rules of a closed-unmerged promotion to draft with the link cleared", async () => {
		const { promotion, rules } = proposedPromotion(11, 2);
		const summary = await refreshPromotions(deps(fakeClient({ 11: "closed" })));

		expect(summary.closed).toBe(1);
		expect(summary.returnedToDraft).toBe(2);
		expect(getPromotion(db, promotion.id)?.state).toBe("closed");
		for (const rule of rules) {
			const after = getRule(db, rule.id);
			expect(after?.status).toBe("draft");
			expect(after?.promotion_id).toBeNull();
		}
	});

	test("a closed promotion does not disturb rules that already moved on", async () => {
		const { promotion, rules } = proposedPromotion(12, 2);
		const [stillProposed, verified] = rules;
		if (!stillProposed || !verified) throw new Error("missing rules");
		transitionRule(db, verified.id, "verified", SEED_NOW);

		const summary = await refreshPromotions(deps(fakeClient({ 12: "closed" })));

		expect(summary.returnedToDraft).toBe(1);
		expect(getRule(db, stillProposed.id)?.status).toBe("draft");
		expect(getRule(db, verified.id)?.status).toBe("verified");
		expect(getRule(db, verified.id)?.promotion_id).toBe(promotion.id);
	});

	test("an open promotion is only touched", async () => {
		const { promotion } = proposedPromotion(13);
		const summary = await refreshPromotions(deps(fakeClient({ 13: "open" })));

		expect(summary.unchanged).toBe(1);
		const after = getPromotion(db, promotion.id);
		expect(after?.state).toBe("open");
		expect(after?.last_checked_at).toBe(CHECKED.toISOString());
	});

	test("never re-checks a promotion that is already merged or closed", async () => {
		const { promotion } = proposedPromotion(14);
		const client = fakeClient({ 14: "merged" });
		await refreshPromotions(deps(client));
		await refreshPromotions(deps(client));
		expect(client.checked).toEqual([14]);
		expect(getPromotion(db, promotion.id)?.state).toBe("merged");
	});

	test("one failing promotion does not stop the others", async () => {
		const first = proposedPromotion(15);
		const second = proposedPromotion(16);
		const client = fakeClient(
			{ 16: "merged" },
			{ 15: new GitHubError("acme/mono: 404 Not Found", 404) },
		);

		const summary = await refreshPromotions(deps(client));

		expect(summary.errors).toEqual([
			{ promotionId: first.promotion.id, message: "acme/mono: 404 Not Found" },
		]);
		expect(summary.merged).toBe(1);
		expect(getPromotion(db, first.promotion.id)?.state).toBe("open");
		expect(getPromotion(db, second.promotion.id)?.state).toBe("merged");
	});

	test("skips a promotion that has no pull request number", async () => {
		insertPromotion(
			db,
			{
				repo_id: repo.id,
				branch: "notam/rules-orphan",
				pr_number: null,
				pr_url: null,
			},
			SEED_NOW,
		);
		const client = fakeClient({});
		const summary = await refreshPromotions(deps(client));
		expect(client.checked).toEqual([]);
		expect(summary.checked).toBe(0);
	});

	test("filters to one repository when asked", async () => {
		proposedPromotion(17);
		const client = fakeClient({ 17: "merged" });
		const summary = await refreshPromotions(deps(client), {
			repoId: "r_other",
		});
		expect(summary.checked).toBe(0);
		expect(client.checked).toEqual([]);
		expect(listPromotions(db, repo.id)[0]?.state).toBe("open");
	});
});
