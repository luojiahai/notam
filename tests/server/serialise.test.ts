import { describe, expect, test } from "bun:test";
import {
	toEntryDetail,
	toEntrySummary,
	toRepoSummary,
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
				kind: "do",
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
		const summary = RepoSummarySchema.parse(toRepoSummary(db, repo, host));
		expect(summary.host_label).toBe("GitHub");
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
