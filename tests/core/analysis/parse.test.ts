import { describe, expect, test } from "bun:test";
import {
	extractJsonBlock,
	extractResultText,
	parseAnalyserOutput,
} from "../../../src/core/analysis/parse.ts";

const RULE = {
	kind: "do",
	directive: "Always add a regression test alongside a bug fix.",
	rationale: "Reviewers kept asking for one.",
	scope_globs: ["services/payments/**"],
	confidence: 0.8,
	source_comment_urls: ["https://github.com/acme/mono/pull/1#discussion_r1"],
};

/** The shape `claude -p --output-format json` actually returns. */
function envelope(result: string, isError = false): string {
	return JSON.stringify({
		type: "result",
		subtype: isError ? "error_during_execution" : "success",
		is_error: isError,
		session_id: "s1",
		result,
	});
}

function fenced(value: unknown): string {
	return (
		"Here is what I found:\n\n```json\n" +
		JSON.stringify(value, null, 2) +
		"\n```\n"
	);
}

describe("extractResultText", () => {
	test("pulls the result field out of the envelope", () => {
		expect(extractResultText(envelope("hello"))).toBe("hello");
	});

	test("falls back to the raw stdout when it is not an envelope", () => {
		expect(extractResultText("```json\n[]\n```")).toBe("```json\n[]\n```");
	});

	test("tolerates leading and trailing whitespace around the envelope", () => {
		expect(extractResultText(`\n${envelope("hi")}\n`)).toBe("hi");
	});
});

describe("extractJsonBlock", () => {
	test("finds a ```json fence", () => {
		expect(extractJsonBlock("chat\n```json\n[1]\n```\nmore")).toBe("[1]");
	});

	test("finds an unlabelled ``` fence", () => {
		expect(extractJsonBlock("```\n[2]\n```")).toBe("[2]");
	});

	test("falls back to the first balanced array when there is no fence", () => {
		expect(extractJsonBlock('prose [{"a": "]"}] trailing')).toBe(
			'[{"a": "]"}]',
		);
	});

	test("returns null when there is no array at all", () => {
		expect(extractJsonBlock("I could not find any rules.")).toBeNull();
	});
});

describe("parseAnalyserOutput", () => {
	test("accepts a fenced array inside the envelope", () => {
		const result = parseAnalyserOutput(envelope(fenced([RULE])));
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error(result.error);
		expect(result.rules).toHaveLength(1);
		expect(result.rules[0]?.directive).toBe(RULE.directive);
	});

	test("accepts an empty array — a PR need not yield a rule", () => {
		const result = parseAnalyserOutput(envelope(fenced([])));
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error(result.error);
		expect(result.rules).toEqual([]);
	});

	test("accepts prose-wrapped output with no fence", () => {
		const result = parseAnalyserOutput(
			envelope(
				`I found one rule: ${JSON.stringify([RULE])} — hope that helps.`,
			),
		);
		expect(result.ok).toBe(true);
	});

	test("fills in the optional arrays a terse model omitted", () => {
		const terse = {
			kind: "dont",
			directive: "Don't log full card numbers.",
			rationale: "PCI.",
			confidence: 1,
		};
		const result = parseAnalyserOutput(envelope(fenced([terse])));
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error(result.error);
		expect(result.rules[0]?.scope_globs).toEqual([]);
		expect(result.rules[0]?.source_comment_urls).toEqual([]);
	});

	test("reports an envelope that flagged its own error", () => {
		const result = parseAnalyserOutput(envelope("Execution failed", true));
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("expected a failure");
		expect(result.error).toContain("Execution failed");
	});

	test("reports output with no JSON at all", () => {
		const result = parseAnalyserOutput(envelope("I could not find any rules."));
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("expected a failure");
		expect(result.error).toContain("no JSON array");
	});

	test("reports malformed JSON", () => {
		const result = parseAnalyserOutput(envelope('```json\n[{"kind": \n```'));
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("expected a failure");
		expect(result.error).toContain("not valid JSON");
	});

	test("reports schema violations with the offending index and field", () => {
		const result = parseAnalyserOutput(
			envelope(fenced([{ ...RULE, confidence: 4 }])),
		);
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("expected a failure");
		expect(result.error).toContain("[0].confidence");
	});

	test("reports a bare object that was not wrapped in an array", () => {
		const result = parseAnalyserOutput(
			envelope("```json\n" + JSON.stringify(RULE) + "\n```"),
		);
		expect(result.ok).toBe(false);
	});

	test("reports a partial rule with the missing field named", () => {
		const result = parseAnalyserOutput(
			envelope(fenced([{ kind: "do", directive: "Something." }])),
		);
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("expected a failure");
		expect(result.error).toContain("[0].rationale");
	});
});
