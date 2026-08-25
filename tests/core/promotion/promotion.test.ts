import type { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { GitHubError } from "../../../src/core/github/client.ts";
import type {
	CreatePRRequest,
	CreatePRResult,
	GitDataClient,
	RepoRef,
} from "../../../src/core/github/types.ts";
import {
	type PromotionDeps,
	PromotionError,
	planPromotion,
	promoteRules,
} from "../../../src/core/promotion/index.ts";
import { transitionRule } from "../../../src/core/rules/state.ts";
import type {
	EntryRow,
	HostRow,
	NewRule,
	PromotionState,
	RepoRow,
} from "../../../src/shared/types.ts";
import { getEntryByNumber, upsertEntry } from "../../../src/store/entries.ts";
import { listPromotions } from "../../../src/store/promotions.ts";
import { upsertRepo } from "../../../src/store/repos.ts";
import { getRule, insertRules, listRules } from "../../../src/store/rules.ts";
import { normalisedEntry, SEED_NOW, seedDatabase } from "../../helpers/seed.ts";

function newRule(overrides: Partial<NewRule> = {}): NewRule {
	return {
		type: "testing",
		directive: "Always add a regression test alongside a bug fix.",
		rationale: "Reviewers kept asking for one.",
		scope_globs: ["services/payments/**"],
		confidence: 0.9,
		source_comment_urls: [],
		file_slug: "always-add-a-test",
		...overrides,
	};
}

type FakeClient = GitDataClient & {
	requests: CreatePRRequest[];
	existing: string[];
};

function fakeClient(
	options: { existing?: string[]; fail?: Error } = {},
): FakeClient {
	const requests: CreatePRRequest[] = [];
	return {
		requests,
		existing: options.existing ?? [],
		async listRuleFiles(): Promise<string[]> {
			return options.existing ?? [];
		},
		async createPRWithFiles(
			_repo: RepoRef,
			request: CreatePRRequest,
		): Promise<CreatePRResult> {
			requests.push(request);
			if (options.fail) throw options.fail;
			return {
				number: 99,
				url: "https://github.com/acme/mono/pull/99",
				branch: request.branch,
				commitSha: "new-commit",
			};
		},
		async getPRState(): Promise<PromotionState> {
			return "open";
		},
	};
}

let db: Database;
let repo: RepoRow;
let entry: EntryRow;

function deps(
	client: GitDataClient,
	overrides: Partial<PromotionDeps> = {},
): PromotionDeps {
	return {
		db,
		clientFor: (_host: HostRow) => client,
		now: () => SEED_NOW,
		suffix: () => "abc123",
		...overrides,
	};
}

beforeEach(() => {
	const seeded = seedDatabase();
	db = seeded.db;
	repo = seeded.repo;
	entry = seeded.entry;
});
afterEach(() => db.close());

function drafts(...rules: NewRule[]) {
	return insertRules(db, repo.id, entry.id, rules, SEED_NOW);
}

describe("planPromotion", () => {
	test("renders one file per rule under .claude/rules", async () => {
		const [rule] = drafts(newRule());
		if (!rule) throw new Error("no rule");
		const plan = await planPromotion(deps(fakeClient()), [rule.id]);

		expect(plan.repo.id).toBe(repo.id);
		expect(plan.files).toHaveLength(1);
		expect(plan.files[0]?.path).toBe(".claude/rules/always-add-a-test.md");
		expect(plan.files[0]?.content).toContain("type: testing");
		expect(plan.files[0]?.content).toContain(entry.url);
		expect(plan.files[0]?.sourceNumber).toBe(4821);
		expect(plan.collisions).toEqual([]);
	});

	test("flags a slug that already exists on the base branch and suffixes it", async () => {
		const [rule] = drafts(newRule());
		if (!rule) throw new Error("no rule");
		const plan = await planPromotion(
			deps(fakeClient({ existing: ["always-add-a-test.md"] })),
			[rule.id],
		);

		expect(plan.files[0]?.path).toBe(".claude/rules/always-add-a-test-2.md");
		expect(plan.collisions).toEqual([
			{
				ruleId: rule.id,
				reason: "base-branch",
				existing: ".claude/rules/always-add-a-test.md",
				path: ".claude/rules/always-add-a-test-2.md",
			},
		]);
	});

	test("suffixes two rules in the same batch that want the same name", async () => {
		const rules = drafts(
			newRule({ directive: "A" }),
			newRule({ directive: "B" }),
		);
		const plan = await planPromotion(
			deps(fakeClient()),
			rules.map((r) => r.id),
		);
		expect(plan.files.map((f) => f.path)).toEqual([
			".claude/rules/always-add-a-test.md",
			".claude/rules/always-add-a-test-2.md",
		]);
		expect(plan.collisions.map((c) => c.reason)).toEqual(["batch"]);
	});

	test("refuses an empty selection", async () => {
		await expect(planPromotion(deps(fakeClient()), [])).rejects.toThrow(
			PromotionError,
		);
	});

	test("refuses an unknown rule id and names it", async () => {
		await expect(
			planPromotion(deps(fakeClient()), ["ru_nope"]),
		).rejects.toThrow(/ru_nope/);
	});

	test("refuses a selection spanning two repositories", async () => {
		const other = upsertRepo(
			db,
			"github",
			{
				host: "github",
				name: "acme/other",
				path_globs: [],
				default_branch: "main",
				window_days: 180,
			},
			SEED_NOW,
		);
		const otherNormalised = normalisedEntry({ number: 10 });
		upsertEntry(db, other.id, otherNormalised, SEED_NOW);
		const otherEntry = getEntryByNumber(db, other.id, 10);
		if (!otherEntry) throw new Error("no entry");

		const [here] = drafts(newRule());
		const [there] = insertRules(
			db,
			other.id,
			otherEntry.id,
			[newRule()],
			SEED_NOW,
		);
		if (!here || !there) throw new Error("no rules");

		await expect(
			planPromotion(deps(fakeClient()), [here.id, there.id]),
		).rejects.toThrow(/single repository/i);
	});

	test("refuses a rule that is not a draft", async () => {
		const [rule] = drafts(newRule());
		if (!rule) throw new Error("no rule");
		transitionRule(db, rule.id, "abandoned", SEED_NOW);
		await expect(planPromotion(deps(fakeClient()), [rule.id])).rejects.toThrow(
			/draft/i,
		);
	});
});

describe("promoteRules", () => {
	test("opens the pull request and moves every rule to proposed", async () => {
		const client = fakeClient();
		const rules = drafts(
			newRule({ directive: "A" }),
			newRule({ directive: "B", file_slug: "b" }),
		);
		const plan = await planPromotion(
			deps(client),
			rules.map((r) => r.id),
		);
		const promotion = await promoteRules(deps(client), plan);

		expect(promotion.state).toBe("open");
		expect(promotion.pr_number).toBe(99);
		expect(promotion.pr_url).toBe("https://github.com/acme/mono/pull/99");
		expect(promotion.branch).toBe("notam/rules-20260823-abc123");
		expect(listPromotions(db, repo.id)).toHaveLength(1);

		for (const rule of rules) {
			const after = getRule(db, rule.id);
			expect(after?.status).toBe("proposed");
			expect(after?.promotion_id).toBe(promotion.id);
		}
	});

	test("sends the base branch, the files, and a traceable body", async () => {
		const client = fakeClient();
		const [rule] = drafts(newRule());
		if (!rule) throw new Error("no rule");
		const plan = await planPromotion(deps(client), [rule.id]);
		await promoteRules(deps(client), plan);

		const request = client.requests[0];
		expect(request?.baseBranch).toBe("main");
		expect(request?.branch).toBe("notam/rules-20260823-abc123");
		expect(request?.title).toBe("Add 1 NOTAM rule");
		expect(request?.message).toBe("Add 1 NOTAM rule");
		expect(request?.files).toHaveLength(1);
		expect(request?.files[0]?.path).toBe(".claude/rules/always-add-a-test.md");
		expect(request?.body).toContain("#4821");
	});

	test("accepts a caller-supplied title", async () => {
		const client = fakeClient();
		const [rule] = drafts(newRule());
		if (!rule) throw new Error("no rule");
		const plan = await planPromotion(deps(client), [rule.id]);
		await promoteRules(deps(client), plan, {
			title: "Adopt the payments rules",
		});
		expect(client.requests[0]?.title).toBe("Adopt the payments rules");
	});

	test("a push failure leaves every rule draft and writes no promotion", async () => {
		const client = fakeClient({
			fail: new GitHubError("acme/mono: 403 Resource not accessible", 403),
		});
		const rules = drafts(newRule());
		const plan = await planPromotion(
			deps(client),
			rules.map((r) => r.id),
		);

		await expect(promoteRules(deps(client), plan)).rejects.toThrow(
			/Resource not accessible/,
		);
		expect(listPromotions(db, repo.id)).toEqual([]);
		expect(listRules(db, repo.id, { status: "draft" })).toHaveLength(1);
		expect(listRules(db, repo.id, { status: "proposed" })).toHaveLength(0);
	});

	test("refuses a plan with no files", async () => {
		const client = fakeClient();
		const [rule] = drafts(newRule());
		if (!rule) throw new Error("no rule");
		const plan = await planPromotion(deps(client), [rule.id]);
		await expect(
			promoteRules(deps(client), { ...plan, files: [] }),
		).rejects.toThrow(PromotionError);
	});

	test("refuses to promote a plan whose rules have since moved on", async () => {
		const client = fakeClient();
		const [rule] = drafts(newRule());
		if (!rule) throw new Error("no rule");
		const plan = await planPromotion(deps(client), [rule.id]);
		// Someone abandoned it in another tab between the dialog and the confirm.
		transitionRule(db, rule.id, "abandoned", SEED_NOW);
		await expect(promoteRules(deps(client), plan)).rejects.toThrow(
			/abandoned|cannot move/i,
		);
		// The pre-network check must catch this before any pull request is
		// opened: no request was ever sent, and nothing was written.
		expect(client.requests).toEqual([]);
		expect(listPromotions(db, repo.id)).toEqual([]);
	});
});
