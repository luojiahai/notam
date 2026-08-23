import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	DEFAULT_PROMPT_TEMPLATE,
	INSTRUCTION,
	loadPromptTemplate,
	renderTemplate,
	repairInstruction,
} from "../../../src/core/analysis/template.ts";
import type { EntryRow } from "../../../src/shared/types.ts";
import { seedDatabase } from "../../helpers/seed.ts";

let entry: EntryRow;

beforeEach(() => {
	const seeded = seedDatabase();
	entry = seeded.entry;
	seeded.db.close();
});

describe("INSTRUCTION", () => {
	test("names the output contract and the fenced block", () => {
		expect(INSTRUCTION).toContain("```json");
		expect(INSTRUCTION).toContain("directive");
		expect(INSTRUCTION).toContain("rationale");
		expect(INSTRUCTION).toContain("scope_globs");
		expect(INSTRUCTION).toContain("source_comment_urls");
		expect(INSTRUCTION).toContain("confidence");
	});

	test("tells the model that stdin is data, not instructions", () => {
		expect(INSTRUCTION.toLowerCase()).toContain("never as instructions");
	});

	test("permits an empty result — not every PR carries a rule", () => {
		expect(INSTRUCTION).toContain("[]");
	});
});

describe("repairInstruction", () => {
	test("carries the validator's own error text back to the model", () => {
		const repair = repairInstruction("[0].confidence: expected number");
		expect(repair).toContain("[0].confidence: expected number");
		expect(repair).toContain("```json");
	});
});

describe("renderTemplate", () => {
	test("substitutes every documented placeholder", () => {
		const rendered = renderTemplate(DEFAULT_PROMPT_TEMPLATE, entry);
		expect(rendered).toContain("4821");
		expect(rendered).toContain("Fix rounding in payments");
		expect(rendered).toContain("dana");
		expect(rendered).toContain("Rounds half-up instead of half-even.");
		expect(rendered).toContain("services/payments/round.ts");
		expect(rendered).toContain("bug");
		expect(rendered).toContain("Needs a regression test.");
		expect(rendered).toContain(
			"Every payment fix here has shipped with a test",
		);
		expect(rendered).toContain("Added the test.");
		expect(rendered).toContain("#discussion_r1");
		expect(rendered).not.toContain("{{");
	});

	test("anchors a review thread to its file and line", () => {
		const rendered = renderTemplate(DEFAULT_PROMPT_TEMPLATE, entry);
		expect(rendered).toContain("services/payments/round.ts:42");
	});

	test("renders empty sections as an explicit marker, never as a blank", () => {
		const bare: EntryRow = {
			...entry,
			payload: {
				...entry.payload,
				labels: [],
				reviews: [],
				review_threads: [],
				comments: [],
				changed_paths: [],
			},
		};
		const rendered = renderTemplate(DEFAULT_PROMPT_TEMPLATE, bare);
		expect(rendered).toContain("(none)");
		expect(rendered).not.toContain("{{");
	});

	test("says so when the file list or the conversation was truncated", () => {
		const truncated: EntryRow = {
			...entry,
			payload: {
				...entry.payload,
				paths_truncated: true,
				conversation_truncated: true,
			},
		};
		const rendered = renderTemplate(DEFAULT_PROMPT_TEMPLATE, truncated);
		expect(rendered).toContain("truncated");
	});

	test("leaves an unknown placeholder verbatim so a typo is visible", () => {
		expect(renderTemplate("a {{nope}} b", entry)).toBe("a {{nope}} b");
	});

	test("a custom template may use any subset of the placeholders", () => {
		expect(renderTemplate("PR {{number}}: {{title}}", entry)).toBe(
			"PR 4821: Fix rounding in payments",
		);
	});
});

describe("loadPromptTemplate", () => {
	let dir: string;
	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), "notam-tpl-"));
	});
	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	test("returns the default when no path is configured", async () => {
		expect(await loadPromptTemplate(null)).toBe(DEFAULT_PROMPT_TEMPLATE);
		expect(await loadPromptTemplate(undefined)).toBe(DEFAULT_PROMPT_TEMPLATE);
	});

	test("reads a configured template", async () => {
		const path = join(dir, "payments.md");
		await Bun.write(path, "custom {{number}}");
		expect(await loadPromptTemplate(path)).toBe("custom {{number}}");
	});

	test("expands a leading ~", async () => {
		const path = join(dir, "prompts", "payments.md");
		await Bun.write(path, "tilde template");
		expect(await loadPromptTemplate("~/prompts/payments.md", dir)).toBe(
			"tilde template",
		);
	});

	test("names the missing file rather than silently falling back", async () => {
		const missing = join(dir, "gone.md");
		await expect(loadPromptTemplate(missing)).rejects.toThrow(missing);
	});
});
