import { describe, expect, test } from "bun:test";
import {
	toEntryDetail,
	toEntrySummary,
	toRepoSummary,
	toRepoSync,
	toRuleDetail,
	toRuleSummary,
} from "../../src/server/serialise.ts";
import {
	EntryDetailSchema,
	EntrySummarySchema,
	RepoSummarySchema,
	RuleDetailSchema,
	RuleSummarySchema,
} from "../../src/shared/api.ts";
import type { JobRow } from "../../src/shared/types.ts";
import { getHost } from "../../src/store/hosts.ts";
import { insertRules, listRulesByEntry } from "../../src/store/rules.ts";
import { SEED_NOW, seedDatabase } from "../helpers/seed.ts";

function withRule() {
	const seeded = seedDatabase();
	insertRules(
		seeded.db,
		seeded.repo.id,
		seeded.entry.id,
		[
			{
				type: "testing",
				directive: "Always add a regression test alongside a bug fix.",
				rationale: "Reviewers blocked untested payment fixes.",
				scope_globs: ["services/payments/**"],
				confidence: 0.9,
				source_comment_urls: [
					"https://github.com/acme/mono/pull/4821#discussion_r1",
				],
				file_slug: "always-add-a-regression-test-alongside-a-bug-fix",
			},
		],
		SEED_NOW,
	);
	return seeded;
}

describe("serialise", () => {
	test("a repo summary carries zero-filled counts and its host label", () => {
		const { db, repo, hostId } = withRule();
		const host = getHost(db, hostId);
		if (!host) throw new Error("seed host vanished");
		const summary = RepoSummarySchema.parse(
			toRepoSummary(db, repo, host, { pending: null, last: null }),
		);
		expect(summary.host_label).toBe("GitHub");
		expect(summary.url).toBe("https://github.com/acme/mono");
		expect(summary.entries).toEqual({
			total: 1,
			unanalysed: 1,
			queued: 0,
			running: 0,
			analysed: 0,
			failed: 0,
		});
		expect(summary.rules.draft).toBe(1);
		expect(summary.rules.total).toBe(1);
		expect(summary.open_promotions).toBe(0);
		db.close();
	});

	test("an entry summary reports the matched glob and the comment count", () => {
		const { db, repo, entry } = withRule();
		const summary = EntrySummarySchema.parse(toEntrySummary(entry, repo, 1, 1));
		expect(summary.matched_prefix).toBe("services/payments/**");
		// One review body + one thread comment + one issue comment.
		expect(summary.comment_count).toBe(3);
		expect(summary.changed_file_count).toBe(1);
		expect(summary.rule_count).toBe(1);
		expect(summary.draft_rule_count).toBe(1);
		db.close();
	});

	test("an entry detail carries the conversation and the derived rules", () => {
		const { db, repo, entry } = withRule();
		const rules = listRulesByEntry(db, entry.id);
		const detail = EntryDetailSchema.parse(toEntryDetail(entry, repo, rules));
		expect(detail.review_threads[0]?.line).toBe(42);
		expect(detail.draft_rule_count).toBe(1);
		expect(detail.rules).toHaveLength(1);
		expect(detail.rules[0]?.source_number).toBe(4821);
		db.close();
	});

	test("a rule summary denormalises its source pull request", () => {
		const { db, entry } = withRule();
		const rule = listRulesByEntry(db, entry.id)[0];
		if (!rule) throw new Error("seed rule vanished");
		const summary = RuleSummarySchema.parse(toRuleSummary(rule, entry));
		expect(summary.source_number).toBe(4821);
		expect(summary.source_url).toBe(entry.url);
		db.close();
	});

	test("a rule detail previews the exact file that would be committed", () => {
		const { db, entry } = withRule();
		const rule = listRulesByEntry(db, entry.id)[0];
		if (!rule) throw new Error("seed rule vanished");
		const detail = RuleDetailSchema.parse(toRuleDetail(rule, entry));
		expect(detail.file_path).toBe(
			".claude/rules/always-add-a-regression-test-alongside-a-bug-fix.md",
		);
		expect(detail.file_preview).toContain("notam: true");
		expect(detail.file_preview).toContain(
			"Always add a regression test alongside a bug fix.",
		);
		db.close();
	});
});

describe("toRepoSync", () => {
	function job(overrides: Partial<JobRow>): JobRow {
		return {
			id: "j_1",
			kind: "sync",
			target_id: "r_1",
			state: "done",
			attempts: 1,
			error: null,
			created_at: "2026-08-23T09:00:00.000Z",
			started_at: "2026-08-23T09:00:01.000Z",
			finished_at: "2026-08-23T09:00:09.000Z",
			...overrides,
		};
	}

	test("reports idle when nothing has ever run", () => {
		expect(toRepoSync({ pending: null, last: null })).toEqual({
			state: "idle",
			started_at: null,
			last: null,
		});
	});

	test("reports a queued job without a start time it does not have", () => {
		const sync = toRepoSync({
			pending: job({ state: "queued", started_at: null }),
			last: null,
		});
		expect(sync.state).toBe("queued");
		expect(sync.started_at).toBeNull();
	});

	test("reports a running job with when it was claimed", () => {
		const sync = toRepoSync({
			pending: job({ state: "running" }),
			last: null,
		});
		expect(sync.state).toBe("running");
		expect(sync.started_at).toBe("2026-08-23T09:00:01.000Z");
	});

	test("carries a failure's error text through verbatim", () => {
		const sync = toRepoSync({
			pending: null,
			last: job({ state: "failed", error: "401 Bad credentials" }),
		});
		expect(sync.last).toEqual({
			outcome: "failed",
			at: "2026-08-23T09:00:09.000Z",
			error: "401 Bad credentials",
		});
	});

	test("reports a cancelled sync as its own outcome, not as a failure", () => {
		const sync = toRepoSync({
			pending: null,
			last: job({ state: "cancelled" }),
		});
		expect(sync.last?.outcome).toBe("cancelled");
		expect(sync.last?.error).toBeNull();
	});

	test("shows a new sync running while still remembering the last outcome", () => {
		const sync = toRepoSync({
			pending: job({ id: "j_2", state: "running" }),
			last: job({ state: "failed", error: "boom" }),
		});
		expect(sync.state).toBe("running");
		expect(sync.last?.outcome).toBe("failed");
	});

	test("falls back to created_at for a settled job with no finish stamp", () => {
		const sync = toRepoSync({
			pending: null,
			last: job({ state: "done", finished_at: null }),
		});
		expect(sync.last?.at).toBe("2026-08-23T09:00:00.000Z");
	});
});
