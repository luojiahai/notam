import { describe, expect, test } from "bun:test";
import { GitHubError } from "../../src/core/github/client.ts";
import { createApp } from "../../src/server/app.ts";
import { createContext } from "../../src/server/context.ts";
import type { ServerEvent } from "../../src/shared/api.ts";
import {
	PromotionPlanSchema,
	PromotionSummarySchema,
	RefreshSummarySchema,
} from "../../src/shared/api.ts";
import { getEntryByNumber, upsertEntry } from "../../src/store/entries.ts";
import { listPromotions } from "../../src/store/promotions.ts";
import { upsertRepo } from "../../src/store/repos.ts";
import { insertRules, listRulesByEntry } from "../../src/store/rules.ts";
import { normalisedEntry, SEED_NOW, seedDatabase } from "../helpers/seed.ts";
import { TEST_CONFIG, testContext } from "./helpers.ts";

function seedDraft(harness: ReturnType<typeof testContext>) {
	return insertRules(
		harness.db,
		harness.repoId,
		harness.entryId,
		[
			{
				kind: "do",
				directive: "Always add a regression test alongside a bug fix.",
				rationale: "Reviewers blocked untested payment fixes.",
				scope_globs: ["services/payments/**"],
				confidence: 0.9,
				source_comment_urls: [],
				file_slug: "always-add-a-regression-test",
			},
		],
		SEED_NOW,
	);
}

/** A second repository with one entry and one draft rule of its own. */
function seedOtherRepo(harness: ReturnType<typeof testContext>) {
	const repo = upsertRepo(
		harness.db,
		"github",
		{
			host: "github",
			name: "acme/other",
			path_globs: ["**"],
			default_branch: "main",
			window_days: 180,
		},
		SEED_NOW,
	);
	upsertEntry(harness.db, repo.id, normalisedEntry({ number: 77 }), SEED_NOW);
	const entry = getEntryByNumber(harness.db, repo.id, 77);
	if (!entry) throw new Error("second entry vanished");
	const [rule] = insertRules(
		harness.db,
		repo.id,
		entry.id,
		[
			{
				kind: "dont",
				directive: "Never round money with floats.",
				rationale: "Money is integers.",
				scope_globs: [],
				confidence: 0.8,
				source_comment_urls: [],
				file_slug: "never-round-money-with-floats",
			},
		],
		SEED_NOW,
	);
	if (!rule) throw new Error("second rule vanished");
	return { repo, rule };
}

function post(
	harness: ReturnType<typeof testContext>,
	path: string,
	body: unknown,
) {
	return harness.app.request(path, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});
}

/** The JSON error envelope every failure shares, typed so assertions can read it. */
async function errorMessage(response: Response): Promise<string> {
	const body = (await response.json()) as { error: { message: string } };
	return body.error.message;
}

describe("promotion routes", () => {
	test("plan reports no collision on a clean base branch", async () => {
		const harness = testContext();
		const [rule] = seedDraft(harness);
		if (!rule) throw new Error("seed rule vanished");
		const plan = PromotionPlanSchema.parse(
			await (
				await post(harness, "/api/promotions/plan", { rule_ids: [rule.id] })
			).json(),
		);
		expect(plan.repo_name).toBe("acme/mono");
		expect(plan.base_branch).toBe("main");
		expect(plan.files[0]?.path).toBe(
			".claude/rules/always-add-a-regression-test.md",
		);
		expect(plan.collisions).toEqual([]);
		harness.close();
	});

	test("plan names the collision when the slug already exists on the base branch", async () => {
		const harness = testContext();
		harness.gitData.ruleFiles = ["always-add-a-regression-test.md"];
		const [rule] = seedDraft(harness);
		if (!rule) throw new Error("seed rule vanished");
		const plan = PromotionPlanSchema.parse(
			await (
				await post(harness, "/api/promotions/plan", { rule_ids: [rule.id] })
			).json(),
		);
		expect(plan.collisions).toHaveLength(1);
		expect(plan.collisions[0]).toMatchObject({
			rule_id: rule.id,
			reason: "base-branch",
			existing: ".claude/rules/always-add-a-regression-test.md",
			path: ".claude/rules/always-add-a-regression-test-2.md",
		});
		expect(plan.collisions[0]?.directive).toContain("regression test");
		// Planning is read-only.
		expect(harness.gitData.created).toHaveLength(0);
		harness.close();
	});

	test("create opens the pull request and moves the rules to proposed", async () => {
		const harness = testContext();
		const [rule] = seedDraft(harness);
		if (!rule) throw new Error("seed rule vanished");
		const response = await post(harness, "/api/promotions", {
			rule_ids: [rule.id],
		});
		const promotion = PromotionSummarySchema.parse(await response.json());
		expect(promotion.state).toBe("open");
		expect(promotion.pr_number).toBe(900);
		expect(promotion.rule_count).toBe(1);
		expect(harness.gitData.created[0]?.files[0]?.path).toBe(
			".claude/rules/always-add-a-regression-test.md",
		);
		expect(harness.gitData.created[0]?.branch).toMatch(
			/^notam\/rules-20260823-[a-z0-9]{6}$/,
		);
		const after = listRulesByEntry(harness.db, harness.entryId)[0];
		expect(after?.status).toBe("proposed");
		expect(after?.promotion_id).toBe(promotion.id);
		harness.close();
	});

	test("create and a closed refresh publish promotion and rules events", async () => {
		const harness = testContext();
		const [rule] = seedDraft(harness);
		if (!rule) throw new Error("seed rule vanished");
		const events: ServerEvent[] = [];
		harness.ctx.bus.subscribe((event) => events.push(event));

		const promotion = PromotionSummarySchema.parse(
			await (
				await post(harness, "/api/promotions", { rule_ids: [rule.id] })
			).json(),
		);
		expect(events).toEqual([
			{
				type: "promotion",
				repo_id: harness.repoId,
				promotion_id: promotion.id,
				state: "open",
			},
			{ type: "rules", repo_id: harness.repoId },
		]);

		// A closed pull request moves rules, so the rules table is told too.
		events.length = 0;
		harness.gitData.prState = "closed";
		await post(harness, "/api/promotions/refresh", {});
		expect(events).toEqual([
			{
				type: "promotion",
				repo_id: harness.repoId,
				promotion_id: promotion.id,
				state: "closed",
			},
			{ type: "rules", repo_id: harness.repoId },
		]);
		harness.close();
	});

	test("a push failure leaves every rule draft and shows GitHub's text verbatim", async () => {
		const harness = testContext();
		harness.gitData.failWith = new GitHubError(
			"POST /repos/acme/mono/git/refs -> 403: Resource not accessible by integration",
			403,
		);
		const [rule] = seedDraft(harness);
		if (!rule) throw new Error("seed rule vanished");
		const response = await post(harness, "/api/promotions", {
			rule_ids: [rule.id],
		});
		expect(response.status).toBe(502);
		expect(await errorMessage(response)).toBe(
			"POST /repos/acme/mono/git/refs -> 403: Resource not accessible by integration",
		);
		expect(listRulesByEntry(harness.db, harness.entryId)[0]?.status).toBe(
			"draft",
		);
		expect(listPromotions(harness.db)).toHaveLength(0);
		harness.close();
	});

	test("a selection spanning statuses is a 400 from the core, not a half-promotion", async () => {
		const harness = testContext();
		const [rule] = seedDraft(harness);
		if (!rule) throw new Error("seed rule vanished");
		await post(harness, "/api/promotions", { rule_ids: [rule.id] });
		// Second attempt: the rule is `proposed` now.
		const response = await post(harness, "/api/promotions", {
			rule_ids: [rule.id],
		});
		expect(response.status).toBe(400);
		expect(await errorMessage(response)).toContain(
			"Only draft rules can be promoted",
		);
		harness.close();
	});

	test("a selection spanning two repositories is refused before any pull request", async () => {
		const harness = testContext();
		const [mine] = seedDraft(harness);
		if (!mine) throw new Error("seed rule vanished");
		const theirs = seedOtherRepo(harness).rule;
		const response = await post(harness, "/api/promotions", {
			rule_ids: [mine.id, theirs.id],
		});
		expect(response.status).toBe(400);
		expect(await errorMessage(response)).toContain(
			"A promotion targets a single repository",
		);
		expect(harness.gitData.created).toHaveLength(0);
		expect(listPromotions(harness.db)).toHaveLength(0);
		harness.close();
	});

	test("an unknown rule id is a 400 naming the id", async () => {
		const harness = testContext();
		const response = await post(harness, "/api/promotions/plan", {
			rule_ids: ["ru_nope"],
		});
		expect(response.status).toBe(400);
		expect(await errorMessage(response)).toContain("ru_nope");
		harness.close();
	});

	test("an empty selection is rejected by the request schema", async () => {
		const harness = testContext();
		const response = await post(harness, "/api/promotions", { rule_ids: [] });
		expect(response.status).toBe(400);
		expect(await errorMessage(response)).toContain("Invalid request");
		expect(harness.gitData.created).toHaveLength(0);
		harness.close();
	});

	test("GET promotions lists them with their rule counts", async () => {
		const harness = testContext();
		const [rule] = seedDraft(harness);
		if (!rule) throw new Error("seed rule vanished");
		await post(harness, "/api/promotions", { rule_ids: [rule.id] });
		const list = (await (
			await harness.app.request(`/api/repos/${harness.repoId}/promotions`)
		).json()) as unknown[];
		expect(list).toHaveLength(1);
		expect(PromotionSummarySchema.parse(list[0]).rule_count).toBe(1);
		harness.close();
	});

	test("GET promotions for an unknown repository is a 404", async () => {
		const harness = testContext();
		const response = await harness.app.request("/api/repos/re_nope/promotions");
		expect(response.status).toBe(404);
		expect(await errorMessage(response)).toBe("No repository with id re_nope");
		harness.close();
	});

	test("refresh returns closed-unmerged rules to draft and reports it", async () => {
		const harness = testContext();
		const [rule] = seedDraft(harness);
		if (!rule) throw new Error("seed rule vanished");
		await post(harness, "/api/promotions", { rule_ids: [rule.id] });
		harness.gitData.prState = "closed";
		const summary = RefreshSummarySchema.parse(
			await (await post(harness, "/api/promotions/refresh", {})).json(),
		);
		expect(summary.checked).toBe(1);
		expect(summary.closed).toBe(1);
		expect(summary.returned_to_draft).toBe(1);
		const after = listRulesByEntry(harness.db, harness.entryId)[0];
		expect(after?.status).toBe("draft");
		expect(after?.promotion_id).toBeNull();
		harness.close();
	});

	test("refresh marks a merged promotion merged without verifying its rules", async () => {
		const harness = testContext();
		const [rule] = seedDraft(harness);
		if (!rule) throw new Error("seed rule vanished");
		await post(harness, "/api/promotions", { rule_ids: [rule.id] });
		harness.gitData.prState = "merged";
		const summary = RefreshSummarySchema.parse(
			await (await post(harness, "/api/promotions/refresh", {})).json(),
		);
		expect(summary.merged).toBe(1);
		// Verification is always a manual decision.
		expect(listRulesByEntry(harness.db, harness.entryId)[0]?.status).toBe(
			"proposed",
		);
		harness.close();
	});

	test("refresh scoped to a repository leaves every other repository alone", async () => {
		const harness = testContext();
		const [mine] = seedDraft(harness);
		if (!mine) throw new Error("seed rule vanished");
		const theirs = seedOtherRepo(harness);
		const minePromotion = PromotionSummarySchema.parse(
			await (
				await post(harness, "/api/promotions", { rule_ids: [mine.id] })
			).json(),
		);
		const theirPromotion = PromotionSummarySchema.parse(
			await (
				await post(harness, "/api/promotions", { rule_ids: [theirs.rule.id] })
			).json(),
		);

		harness.gitData.prState = "merged";
		const summary = RefreshSummarySchema.parse(
			await (
				await post(harness, "/api/promotions/refresh", {
					repo_id: theirs.repo.id,
				})
			).json(),
		);

		// Both promotions are open and both would report "merged" if checked;
		// only the named repository's may have been.
		expect(summary.checked).toBe(1);
		expect(summary.merged).toBe(1);
		const states = new Map(
			listPromotions(harness.db).map((promotion) => [
				promotion.id,
				promotion.state,
			]),
		);
		expect(states.get(theirPromotion.id)).toBe("merged");
		expect(states.get(minePromotion.id)).toBe("open");
		harness.close();
	});

	/**
	 * `applyConfig` is additive, so a host removed from config.yaml — or one
	 * whose `token_env` was renamed — keeps its rows and its repositories keep
	 * appearing. The clients resolve their tokens from those rows lazily, so
	 * the ConfigError lands inside a request. It is a configuration problem,
	 * not a bug: 503 with the variable named, not an anonymous 500.
	 */
	test("a host whose token variable is unset answers 503 naming the variable", async () => {
		const seeded = seedDatabase();
		const ctx = createContext({
			db: seeded.db,
			config: TEST_CONFIG,
			configPath: "/tmp/notam-test/config.yaml",
			dbPath: ":memory:",
			now: () => SEED_NOW,
			version: "test",
			claudeAvailable: true,
			// No gitDataFor: this is the production client factory, resolving its
			// token from an environment that no longer carries it.
			env: {},
		});
		const app = createApp(ctx);
		const [rule] = insertRules(
			seeded.db,
			seeded.repo.id,
			seeded.entry.id,
			[
				{
					kind: "do",
					directive: "Always add a regression test alongside a bug fix.",
					rationale: "Reviewers blocked untested payment fixes.",
					scope_globs: [],
					confidence: 0.9,
					source_comment_urls: [],
					file_slug: "always-add-a-regression-test",
				},
			],
			SEED_NOW,
		);
		if (!rule) throw new Error("seed rule vanished");
		const response = await app.request("/api/promotions/plan", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ rule_ids: [rule.id] }),
		});
		expect(response.status).toBe(503);
		const body = (await response.json()) as { error: { message: string } };
		expect(body.error.message).toContain("NOTAM_TEST_TOKEN");
		ctx.shutdown();
		seeded.db.close();
	});

	test("refresh with nothing open reports an empty summary", async () => {
		const harness = testContext();
		const summary = RefreshSummarySchema.parse(
			await (await post(harness, "/api/promotions/refresh", {})).json(),
		);
		expect(summary).toEqual({
			checked: 0,
			merged: 0,
			closed: 0,
			unchanged: 0,
			returned_to_draft: 0,
			errors: [],
		});
		harness.close();
	});
});
