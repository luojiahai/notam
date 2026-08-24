import { describe, expect, test } from "bun:test";
import type { PRDetail } from "../../src/core/github/types.ts";
import {
	EntriesResponseSchema,
	PromotionPlanSchema,
	PromotionSummarySchema,
	RefreshSummarySchema,
	RulesResponseSchema,
	type ServerEvent,
} from "../../src/shared/api.ts";
import { testContext } from "../server/helpers.ts";

function pr(number: number): PRDetail {
	const url = `https://github.com/acme/mono/pull/${number}`;
	return {
		pullRequest: {
			number,
			title: `Fix rounding in payments (${number})`,
			body: "Rounds half-up instead of half-even.",
			url,
			updatedAt: "2026-08-22T10:00:00Z",
			mergedAt: "2026-08-21T10:00:00Z",
			author: { login: "dana" },
			labels: { nodes: [{ name: "bug" }] },
			reviews: {
				nodes: [
					{
						author: { login: "sam" },
						state: "CHANGES_REQUESTED",
						body: "Needs a regression test.",
						url: `${url}#pullrequestreview-1`,
						submittedAt: "2026-08-20T09:00:00Z",
					},
				],
			},
			reviewThreads: {
				nodes: [
					{
						isResolved: true,
						path: "services/payments/round.ts",
						line: 42,
						comments: {
							nodes: [
								{
									author: { login: "sam" },
									body: "Every payment fix here ships with a test.",
									url: `${url}#discussion_r1`,
									createdAt: "2026-08-20T09:00:00Z",
								},
							],
						},
					},
				],
			},
			comments: { nodes: [] },
		},
		changedPaths: ["services/payments/round.ts"],
		pathsTruncated: false,
	};
}

function post(
	harness: ReturnType<typeof testContext>,
	path: string,
	body?: unknown,
) {
	return harness.app.request(path, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body ?? {}),
	});
}

describe("the whole flow over HTTP", () => {
	test("sync, analyse, promote, refresh, verify", async () => {
		const harness = testContext();
		const events: ServerEvent[] = [];
		harness.ctx.bus.subscribe((event) => events.push(event));

		// The seed already holds #4821; sync brings in #4822.
		harness.github.prs = [pr(4822)];

		// 1. Sync.
		expect(
			(await post(harness, `/api/repos/${harness.repoId}/sync`)).status,
		).toBe(200);
		await harness.ctx.syncRunner.idle();

		const unanalysed = EntriesResponseSchema.parse(
			await (
				await harness.app.request(
					`/api/repos/${harness.repoId}/entries?state=unanalysed`,
				)
			).json(),
		);
		expect(unanalysed.entries.map((entry) => entry.number).sort()).toEqual([
			4821, 4822,
		]);

		// 2. Analyse the whole selection.
		await post(harness, "/api/entries/analyse", {
			entry_ids: unanalysed.entries.map((entry) => entry.id),
		});
		await harness.ctx.analyseRunner.idle();

		const rules = RulesResponseSchema.parse(
			await (
				await harness.app.request(`/api/repos/${harness.repoId}/rules`)
			).json(),
		);
		expect(rules.counts.draft).toBe(2);
		expect(rules.rules.map((rule) => rule.source_number).sort()).toEqual([
			4821, 4822,
		]);

		// 3. Plan. Both entries produced the same directive, so the second file
		//    collides with the first *within the batch* — the case the dialog has
		//    to disclose.
		const ruleIds = rules.rules.map((rule) => rule.id);
		const plan = PromotionPlanSchema.parse(
			await (
				await post(harness, "/api/promotions/plan", { rule_ids: ruleIds })
			).json(),
		);
		expect(plan.files.map((file) => file.path)).toEqual([
			".claude/rules/always-add-a-regression-test-alongside-a-bug-fix.md",
			".claude/rules/always-add-a-regression-test-alongside-a-bug-fix-2.md",
		]);
		expect(plan.collisions).toHaveLength(1);
		expect(plan.collisions[0]?.reason).toBe("batch");

		// 4. Promote.
		const promotion = PromotionSummarySchema.parse(
			await (
				await post(harness, "/api/promotions", { rule_ids: ruleIds })
			).json(),
		);
		expect(promotion.state).toBe("open");
		expect(harness.gitData.created).toHaveLength(1);
		expect(harness.gitData.created[0]?.files).toHaveLength(2);

		const afterPromote = RulesResponseSchema.parse(
			await (
				await harness.app.request(`/api/repos/${harness.repoId}/rules`)
			).json(),
		);
		expect(afterPromote.counts.proposed).toBe(2);
		expect(afterPromote.counts.draft).toBe(0);

		// 5. The team merged it.
		harness.gitData.prState = "merged";
		const refresh = RefreshSummarySchema.parse(
			await (await post(harness, "/api/promotions/refresh", {})).json(),
		);
		expect(refresh.merged).toBe(1);
		// Merging does not verify: that is always the user's call.
		expect(
			RulesResponseSchema.parse(
				await (
					await harness.app.request(`/api/repos/${harness.repoId}/rules`)
				).json(),
			).counts.proposed,
		).toBe(2);

		// 6. The user confirms.
		expect(
			(
				await post(harness, "/api/rules/status", {
					rule_ids: ruleIds,
					status: "verified",
				})
			).status,
		).toBe(200);
		expect(
			RulesResponseSchema.parse(
				await (
					await harness.app.request(`/api/repos/${harness.repoId}/rules`)
				).json(),
			).counts.verified,
		).toBe(2);

		// The browser was told about every stage of that.
		const kinds = new Set(events.map((event) => event.type));
		expect(kinds.has("sync")).toBe(true);
		expect(kinds.has("entry")).toBe(true);
		expect(kinds.has("rules")).toBe(true);
		expect(kinds.has("promotion")).toBe(true);

		harness.close();
	});

	test("a repository sync and an analysis batch do not compete for slots", async () => {
		const harness = testContext();
		harness.github.prs = [pr(4822), pr(4823)];
		await post(harness, `/api/repos/${harness.repoId}/sync`);
		await post(harness, "/api/entries/analyse", {
			entry_ids: [harness.entryId],
		});
		await Promise.all([
			harness.ctx.syncRunner.idle(),
			harness.ctx.analyseRunner.idle(),
		]);
		expect(harness.ctx.queue.count("failed")).toBe(0);
		expect(harness.ctx.queue.count("queued")).toBe(0);
		harness.close();
	});
});
