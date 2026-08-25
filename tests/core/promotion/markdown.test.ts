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
		type: "testing",
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
type: testing
paths:
  - "services/payments/**"
source: "https://ghe.acme.net/mono/pull/4821"
notam: true
---

Always add a regression test alongside a bug fix.

Reviewers repeatedly blocked payment fixes that shipped without a test
reproducing the original failure.
`);
	});

	test("renders an unclassified rule with its type like any other", () => {
		const rendered = renderRuleFile(
			rule({ type: "other", directive: "Never log full card numbers." }),
			"https://x/1",
		);
		expect(rendered).toContain("type: other");
		expect(rendered).toContain("Never log full card numbers.");
	});

	test("omits paths entirely when the rule is unscoped, so it loads at launch", () => {
		const rendered = renderRuleFile(rule({ scope_globs: [] }), "https://x/1");
		expect(rendered).not.toContain("paths");
		expect(rendered).toBe(`---
id: ru_01HX9K2
type: testing
source: "https://x/1"
notam: true
---

Always add a regression test alongside a bug fix.

Reviewers repeatedly blocked payment fixes that shipped without a test
reproducing the original failure.
`);
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
				rule: rule({
					id: "ru_2",
					type: "security",
					directive: "Never log PANs.",
				}),
				path: ".claude/rules/never-log-pans.md",
				sourceUrl: "https://ghe.acme.net/mono/pull/4900",
				sourceNumber: 4900,
			},
		]);

		expect(body).toContain("Always add a regression test alongside a bug fix.");
		expect(body).toContain("Never log PANs.");
		expect(body).toContain(
			"`.claude/rules/always-add-a-regression-test-alongside-a-bug-fix.md`",
		);
		expect(body).toContain("[#4821](https://ghe.acme.net/mono/pull/4821)");
		expect(body).toContain("[#4900](https://ghe.acme.net/mono/pull/4900)");
		expect(body.toLowerCase()).toContain("notam");
	});

	test("groups rules under their type's heading, alphabetically", () => {
		const body = renderPRBody([
			{
				rule: rule(),
				path: ".claude/rules/a.md",
				sourceUrl: "https://x/1",
				sourceNumber: 1,
			},
			{
				rule: rule({ id: "ru_2", type: "security", directive: "Never PANs." }),
				path: ".claude/rules/b.md",
				sourceUrl: "https://x/2",
				sourceNumber: 2,
			},
			{
				rule: rule({ id: "ru_3", type: "security", directive: "Never keys." }),
				path: ".claude/rules/c.md",
				sourceUrl: "https://x/3",
				sourceNumber: 3,
			},
		]);

		expect(body).toContain("### Security requirements");
		expect(body).toContain("### Testing conventions");
		expect(body.indexOf("### Security requirements")).toBeLessThan(
			body.indexOf("### Testing conventions"),
		);
		// Both security rules sit under the one heading.
		expect(body.indexOf("Never PANs.")).toBeLessThan(
			body.indexOf("### Testing conventions"),
		);
		expect(body.indexOf("Never keys.")).toBeLessThan(
			body.indexOf("### Testing conventions"),
		);
	});

	test("omits a heading for a type no rule in the batch has", () => {
		const body = renderPRBody([
			{
				rule: rule(),
				path: ".claude/rules/a.md",
				sourceUrl: "https://x/1",
				sourceNumber: 1,
			},
		]);
		expect(body).toContain("### Testing conventions");
		expect(body).not.toContain("### Security requirements");
		expect(body).not.toContain("### Other");
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
