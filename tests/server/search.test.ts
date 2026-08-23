import { describe, expect, test } from "bun:test";
import {
	matchesEntryQuery,
	matchesRuleQuery,
} from "../../src/server/search.ts";
import type { EntryRow, RuleRow } from "../../src/shared/types.ts";

const entry = {
	title: "Fix rounding in payments",
	author: "dana",
	number: 4821,
	changed_paths: ["services/payments/round.ts"],
} as unknown as EntryRow;

const rule = {
	directive: "Always add a regression test alongside a bug fix.",
	rationale: "Reviewers blocked untested payment fixes.",
} as unknown as RuleRow;

describe("substring search", () => {
	test("an empty or blank query matches everything", () => {
		expect(matchesEntryQuery(entry, "")).toBe(true);
		expect(matchesEntryQuery(entry, "   ")).toBe(true);
		expect(matchesRuleQuery(rule, "")).toBe(true);
	});

	test("entries match on title, author, path, and PR number", () => {
		expect(matchesEntryQuery(entry, "ROUNDING")).toBe(true);
		expect(matchesEntryQuery(entry, "dana")).toBe(true);
		expect(matchesEntryQuery(entry, "services/payments")).toBe(true);
		expect(matchesEntryQuery(entry, "4821")).toBe(true);
		expect(matchesEntryQuery(entry, "billing")).toBe(false);
	});

	test("rules match on directive and rationale, case-insensitively", () => {
		expect(matchesRuleQuery(rule, "REGRESSION")).toBe(true);
		expect(matchesRuleQuery(rule, "untested")).toBe(true);
		expect(matchesRuleQuery(rule, "kubernetes")).toBe(false);
	});
});
