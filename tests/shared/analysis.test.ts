import { describe, expect, test } from "bun:test";
import {
	AnalysedRuleSchema,
	AnalysedRulesSchema,
} from "../../src/shared/analysis.ts";
import { ANALYSABLE_RULE_TYPES } from "../../src/shared/rule-types.ts";

const VALID = {
	type: "testing" as const,
	directive: "Always add a regression test alongside a bug fix.",
	rationale: "Reviewers repeatedly blocked fixes that shipped without one.",
	scope_globs: ["services/payments/**"],
	confidence: 0.8,
	source_comment_urls: ["https://github.com/acme/mono/pull/1#discussion_r1"],
};

describe("AnalysedRuleSchema", () => {
	test("accepts a complete rule", () => {
		expect(AnalysedRuleSchema.parse(VALID)).toEqual(VALID);
	});

	test("defaults the two array fields so a terse model answer still parses", () => {
		const parsed = AnalysedRuleSchema.parse({
			type: "security",
			directive: "Never log full card numbers.",
			rationale: "PCI.",
			confidence: 1,
		});
		expect(parsed.scope_globs).toEqual([]);
		expect(parsed.source_comment_urls).toEqual([]);
	});

	test("keeps every type the analyser is offered", () => {
		for (const type of ANALYSABLE_RULE_TYPES) {
			expect(AnalysedRuleSchema.parse({ ...VALID, type }).type).toBe(type);
		}
	});

	test("coerces a type outside the seven to other rather than failing", () => {
		for (const type of ["style", "perf", "ci", "other", ""]) {
			expect(AnalysedRuleSchema.parse({ ...VALID, type }).type).toBe("other");
		}
	});

	test("still rejects a type that is not a string", () => {
		expect(() => AnalysedRuleSchema.parse({ ...VALID, type: 42 })).toThrow();
		expect(() => AnalysedRuleSchema.parse({ ...VALID, type: null })).toThrow();
		const { type: _, ...missing } = VALID;
		expect(() => AnalysedRuleSchema.parse(missing)).toThrow();
	});

	test("rejects confidence outside 0..1", () => {
		expect(() =>
			AnalysedRuleSchema.parse({ ...VALID, confidence: 1.5 }),
		).toThrow();
		expect(() =>
			AnalysedRuleSchema.parse({ ...VALID, confidence: -0.1 }),
		).toThrow();
	});

	test("rejects an empty directive or rationale", () => {
		expect(() =>
			AnalysedRuleSchema.parse({ ...VALID, directive: "" }),
		).toThrow();
		expect(() =>
			AnalysedRuleSchema.parse({ ...VALID, rationale: "" }),
		).toThrow();
	});

	test("rejects a directive that is a paragraph rather than one line", () => {
		expect(() =>
			AnalysedRuleSchema.parse({ ...VALID, directive: "a".repeat(301) }),
		).toThrow();
		expect(() =>
			AnalysedRuleSchema.parse({ ...VALID, directive: "one\ntwo" }),
		).toThrow();
	});
});

describe("AnalysedRulesSchema", () => {
	test("accepts an empty array — an entry may legitimately yield no rules", () => {
		expect(AnalysedRulesSchema.parse([])).toEqual([]);
	});

	test("rejects a bare object that is not wrapped in an array", () => {
		expect(() => AnalysedRulesSchema.parse(VALID)).toThrow();
	});
});
