import { describe, expect, test } from "bun:test";
import {
	promotionTitle,
	RULES_DIR,
	renderPRBody,
	renderRuleFile,
	rulePath,
} from "../../../src/core/promotion/markdown.ts";
import type { RuleRow } from "../../../src/shared/types.ts";

function rule(overrides: Partial<RuleRow> = {}): RuleRow {
	return {
		id: "ru_01HX9K2",
		repo_id: "r_1",
		entry_id: "e_1",
		kind: "do",
		directive: "Always add a regression test alongside a bug fix.",
		rationale:
			"Reviewers repeatedly blocked payment fixes that shipped without a test\nreproducing the original failure.",
		scope_globs: ["services/payments/**"],
		confidence: 0.9,
		source_comment_urls: [],
		status: "draft",
		promotion_id: null,
		file_slug: "always-add-a-regression-test-alongside-a-bug-fix",
		created_at: "2026-08-23T09:00:00.000Z",
		status_changed_at: "2026-08-23T09:00:00.000Z",
		...overrides,
	};
}

describe("rulePath", () => {
	test("puts the file under .claude/rules", () => {
		expect(RULES_DIR).toBe(".claude/rules");
		expect(rulePath("always-add-a-test")).toBe(
			".claude/rules/always-add-a-test.md",
		);
	});
});

describe("renderRuleFile", () => {
	test("renders the rule file format exactly", () => {
		expect(
			renderRuleFile(rule(), "https://ghe.acme.net/mono/pull/4821"),
		).toBe(`---
id: ru_01HX9K2
kind: do
scope:
  - "services/payments/**"
source: "https://ghe.acme.net/mono/pull/4821"
notam: true
---

Always add a regression test alongside a bug fix.

Reviewers repeatedly blocked payment fixes that shipped without a test
reproducing the original failure.
`);
	});

	test("renders a don't", () => {
		const rendered = renderRuleFile(
			rule({ kind: "dont", directive: "Don't log full card numbers." }),
			"https://x/1",
		);
		expect(rendered).toContain("kind: dont");
		expect(rendered).toContain("Don't log full card numbers.");
	});

	test("renders an empty scope as an empty list, not a null", () => {
		expect(renderRuleFile(rule({ scope_globs: [] }), "https://x/1")).toContain(
			"scope: []",
		);
	});

	test("renders several globs as a YAML list", () => {
		const rendered = renderRuleFile(
			rule({ scope_globs: ["a/**", "b/**"] }),
			"https://x/1",
		);
		expect(rendered).toContain('  - "a/**"\n  - "b/**"');
	});

	test("escapes quotes and backslashes in a glob", () => {
		const rendered = renderRuleFile(
			rule({ scope_globs: ['we"ird\\path/**'] }),
			"https://x/1",
		);
		expect(rendered).toContain('  - "we\\"ird\\\\path/**"');
	});

	test("escapes a newline in a glob so the frontmatter stays parseable", () => {
		const rendered = renderRuleFile(
			rule({ scope_globs: ["services/payments/**\ninjected: true"] }),
			"https://x/1",
		);
		expect(rendered).toContain('  - "services/payments/**\\ninjected: true"');
		// No raw newline snuck through: the glob line is exactly one YAML line.
		expect(rendered).not.toContain("payments/**\ninjected");
	});

	test("escapes carriage returns and tabs in a glob", () => {
		const rendered = renderRuleFile(
			rule({ scope_globs: ["a\r\tb"] }),
			"https://x/1",
		);
		expect(rendered).toContain('  - "a\\r\\tb"');
	});

	test("always ends with exactly one trailing newline", () => {
		const rendered = renderRuleFile(rule(), "https://x/1");
		expect(rendered.endsWith("\n")).toBe(true);
		expect(rendered.endsWith("\n\n")).toBe(false);
	});
});

describe("promotionTitle", () => {
	test("agrees with itself about plurals", () => {
		expect(promotionTitle(1)).toBe("Add 1 NOTAM rule");
		expect(promotionTitle(3)).toBe("Add 3 NOTAM rules");
	});
});

describe("renderPRBody", () => {
	test("lists every rule with its directive, file, and source link", () => {
		const body = renderPRBody([
			{
				rule: rule(),
				path: ".claude/rules/always-add-a-regression-test-alongside-a-bug-fix.md",
				sourceUrl: "https://ghe.acme.net/mono/pull/4821",
				sourceNumber: 4821,
			},
			{
				rule: rule({ id: "ru_2", kind: "dont", directive: "Don't log PANs." }),
				path: ".claude/rules/don-t-log-pans.md",
				sourceUrl: "https://ghe.acme.net/mono/pull/4900",
				sourceNumber: 4900,
			},
		]);

		expect(body).toContain("**DO**");
		expect(body).toContain("**DON'T**");
		expect(body).toContain("Always add a regression test alongside a bug fix.");
		expect(body).toContain("Don't log PANs.");
		expect(body).toContain(
			"`.claude/rules/always-add-a-regression-test-alongside-a-bug-fix.md`",
		);
		expect(body).toContain("[#4821](https://ghe.acme.net/mono/pull/4821)");
		expect(body).toContain("[#4900](https://ghe.acme.net/mono/pull/4900)");
		expect(body.toLowerCase()).toContain("notam");
	});

	test("handles a single rule without breaking the list", () => {
		const body = renderPRBody([
			{
				rule: rule(),
				path: ".claude/rules/a.md",
				sourceUrl: "https://x/1",
				sourceNumber: 1,
			},
		]);
		expect(
			body.split("\n").filter((line) => line.startsWith("- ")).length,
		).toBe(1);
	});
});
