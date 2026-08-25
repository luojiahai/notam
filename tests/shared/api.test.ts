import { describe, expect, test } from "bun:test";
import {
	EntryDetailSchema,
	MetaSchema,
	PINNED_ENUMS,
	PromotionPlanSchema,
	RuleStatusRequestSchema,
	RuleSummarySchema,
	ServerEventSchema,
} from "../../src/shared/api.ts";

const rule = {
	id: "ru_1",
	repo_id: "r_1",
	entry_id: "e_1",
	type: "testing",
	directive: "Always add a regression test alongside a bug fix.",
	rationale: "Reviewers repeatedly blocked fixes without one.",
	scope_globs: ["services/payments/**"],
	confidence: 0.8,
	source_comment_urls: ["https://github.com/acme/mono/pull/4821#discussion_r1"],
	status: "draft",
	promotion_id: null,
	file_slug: "always-add-a-regression-test-alongside-a-bug-fix",
	created_at: "2026-08-23T09:00:00.000Z",
	status_changed_at: "2026-08-23T09:00:00.000Z",
	source_number: 4821,
	source_url: "https://github.com/acme/mono/pull/4821",
};

describe("the wire contract", () => {
	test("accepts a well-formed rule summary", () => {
		expect(RuleSummarySchema.parse(rule).directive).toBe(rule.directive);
	});

	test("rejects a rule with an unknown type", () => {
		const result = RuleSummarySchema.safeParse({ ...rule, type: "maybe" });
		expect(result.success).toBe(false);
	});

	test("an entry detail carries its derived rules", () => {
		const detail = EntryDetailSchema.parse({
			id: "e_1",
			repo_id: "r_1",
			number: 4821,
			title: "Fix rounding in payments",
			author: "dana",
			url: "https://github.com/acme/mono/pull/4821",
			merged_at: "2026-08-20T10:00:00.000Z",
			updated_at: "2026-08-21T10:00:00.000Z",
			matched_prefix: "services/payments/**",
			changed_file_count: 1,
			comment_count: 2,
			paths_truncated: false,
			analysis_state: "analysed",
			analysed_at: "2026-08-23T09:00:00.000Z",
			last_error: null,
			rule_count: 1,
			draft_rule_count: 1,
			body: "Rounds half-up.",
			labels: ["bug"],
			changed_paths: ["services/payments/round.ts"],
			conversation_truncated: false,
			reviews: [],
			review_threads: [],
			comments: [],
			rules: [rule],
		});
		expect(detail.rules[0]?.id).toBe("ru_1");
	});

	test("a promotion plan carries collisions with a reason", () => {
		const plan = PromotionPlanSchema.parse({
			repo_id: "r_1",
			repo_name: "acme/mono",
			base_branch: "main",
			files: [
				{
					rule_id: "ru_1",
					type: "testing",
					directive: rule.directive,
					path: ".claude/rules/always-add-a-regression-test-2.md",
					content: "---\nid: ru_1\n---\n",
				},
			],
			collisions: [
				{
					rule_id: "ru_1",
					directive: rule.directive,
					reason: "base-branch",
					existing: ".claude/rules/always-add-a-regression-test.md",
					path: ".claude/rules/always-add-a-regression-test-2.md",
				},
			],
		});
		expect(plan.collisions[0]?.reason).toBe("base-branch");
	});

	test("the status request refuses a status the UI must not set", () => {
		expect(
			RuleStatusRequestSchema.safeParse({
				rule_ids: ["ru_1"],
				status: "proposed",
			}).success,
		).toBe(false);
		expect(
			RuleStatusRequestSchema.safeParse({
				rule_ids: ["ru_1"],
				status: "abandoned",
			}).success,
		).toBe(true);
	});

	test("the status request refuses an empty selection", () => {
		expect(
			RuleStatusRequestSchema.safeParse({ rule_ids: [], status: "abandoned" })
				.success,
		).toBe(false);
	});

	test("server events discriminate on type", () => {
		const event = ServerEventSchema.parse({
			type: "entry",
			repo_id: "r_1",
			entry_id: "e_1",
			state: "running",
			error: null,
		});
		expect(event.type).toBe("entry");
		expect(ServerEventSchema.safeParse({ type: "nonsense" }).success).toBe(
			false,
		);
	});

	test("the wire enums are pinned to the row-level unions", () => {
		// The value is trivial; the type is the assertion. If a state is added to
		// shared/types.ts and not here (or the reverse), this file stops compiling.
		expect(PINNED_ENUMS).toEqual([true, true, true]);
	});

	test("meta reports the analysis settings the server actually used", () => {
		const meta = MetaSchema.parse({
			version: "dev",
			config_path: "/home/x/.notam/config.yaml",
			db_path: "/home/x/.notam/notam.db",
			claude_available: false,
			warnings: ["The claude CLI was not found on PATH."],
			analysis: { concurrency: 3, timeout_seconds: 120, model: null },
		});
		expect(meta.analysis.concurrency).toBe(3);
	});
});
