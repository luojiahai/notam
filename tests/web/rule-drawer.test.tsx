import { describe, expect, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import type { RuleDetail } from "../../src/shared/api.ts";
import { RuleDrawerView } from "../../web/src/components/RuleDrawer.tsx";

const rule: RuleDetail = {
	id: "ru_1",
	repo_id: "r_1",
	entry_id: "e_1",
	type: "code-style",
	directive: "Never round money with floating point.",
	rationale: "Every rounding bug in payments has come from a float.",
	scope_globs: ["services/payments/**"],
	confidence: 0.85,
	source_comment_urls: [
		"https://github.com/acme/mono/pull/4821#discussion_r1",
		"https://github.com/acme/mono/pull/4821#discussion_r2",
	],
	status: "draft",
	promotion_id: null,
	file_slug: "never-round-money-with-floating-point",
	created_at: "2026-08-23T09:00:00.000Z",
	status_changed_at: "2026-08-23T09:00:00.000Z",
	source_number: 4821,
	source_url: "https://github.com/acme/mono/pull/4821",
	file_path: ".claude/rules/never-round-money-with-floating-point.md",
	file_preview:
		"---\nid: ru_1\ntype: code-style\nnotam: true\n---\n\nNever round money with floating point.\n",
};

describe("RuleDrawerView", () => {
	test("shows the rationale, the source links, and the file preview", () => {
		render(<RuleDrawerView rule={rule} />);
		expect(
			screen.getByText("Every rounding bug in payments has come from a float."),
		).toBeDefined();
		expect(screen.getAllByRole("link", { name: /#discussion_r/ })).toHaveLength(
			2,
		);
		expect(
			screen.getByText(
				".claude/rules/never-round-money-with-floating-point.md",
			),
		).toBeDefined();
		expect(screen.getByText(/notam: true/)).toBeDefined();
	});

	test("offers nothing editable — the drawer is read-only in v1", () => {
		render(<RuleDrawerView rule={rule} />);
		expect(screen.queryAllByRole("textbox")).toHaveLength(0);
		expect(screen.queryAllByRole("button")).toHaveLength(0);
	});

	test("says when a rule has no source comments rather than rendering nothing", () => {
		render(<RuleDrawerView rule={{ ...rule, source_comment_urls: [] }} />);
		expect(screen.getByText(/no source comments/i)).toBeDefined();
	});
});
