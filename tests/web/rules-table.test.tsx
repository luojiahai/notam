import { describe, expect, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { RuleCounts, RuleSummary } from "../../src/shared/api.ts";
import { RulesTable } from "../../web/src/components/RulesTable.tsx";

const counts: RuleCounts = {
	total: 4,
	draft: 2,
	proposed: 1,
	verified: 1,
	abandoned: 0,
};

function rule(overrides: Partial<RuleSummary> = {}): RuleSummary {
	return {
		id: "ru_1",
		repo_id: "r_1",
		entry_id: "e_1",
		kind: "do",
		directive: "Always add a regression test alongside a bug fix.",
		rationale: "Reviewers repeatedly blocked untested payment fixes.",
		scope_globs: ["services/payments/**"],
		confidence: 0.9,
		source_comment_urls: [],
		status: "draft",
		promotion_id: null,
		file_slug: "always-add-a-regression-test",
		created_at: "2026-08-23T09:00:00.000Z",
		status_changed_at: "2026-08-23T09:00:00.000Z",
		source_number: 4821,
		source_url: "https://github.com/acme/mono/pull/4821",
		...overrides,
	};
}

type Props = Parameters<typeof RulesTable>[0];

function draw(overrides: Partial<Props> = {}) {
	const calls = {
		abandon: [] as string[][],
		verify: [] as string[][],
		promote: [] as string[][],
		status: [] as string[],
		sort: [] as string[],
		q: [] as string[],
		opened: [] as string[],
	};
	const props: Props = {
		rules: [rule()],
		counts,
		status: "",
		onStatusChange: (next) => calls.status.push(next),
		query: "",
		onQueryChange: (next) => calls.q.push(next),
		sort: "created",
		onSortChange: (next) => calls.sort.push(next),
		onOpenRule: (id) => calls.opened.push(id),
		onAbandon: (ids) => calls.abandon.push(ids),
		onVerify: (ids) => calls.verify.push(ids),
		onCreatePromotion: (ids) => calls.promote.push(ids),
		loading: false,
		...overrides,
	};
	render(<RulesTable {...props} />);
	return calls;
}

describe("RulesTable", () => {
	test("renders the kind badge, directive, rationale, scope, confidence, and source", () => {
		draw();
		expect(screen.getByText("DO")).toBeDefined();
		expect(
			screen.getByText("Always add a regression test alongside a bug fix."),
		).toBeDefined();
		expect(
			screen.getByText("Reviewers repeatedly blocked untested payment fixes."),
		).toBeDefined();
		expect(screen.getByText("services/payments/**")).toBeDefined();
		expect(screen.getByText("0.90")).toBeDefined();
		expect(screen.getByRole("link", { name: "#4821" })).toBeDefined();
		expect(screen.getByText("draft")).toBeDefined();
	});

	test("chips carry counts and report the chosen status", async () => {
		const calls = draw();
		expect(screen.getByRole("button", { name: "Proposed 1" })).toBeDefined();
		await userEvent.click(screen.getByRole("button", { name: "Draft 2" }));
		expect(calls.status).toEqual(["draft"]);
	});

	test("sorting by directive is a toggle", async () => {
		const calls = draw();
		await userEvent.click(
			screen.getByRole("button", { name: /sort by directive/i }),
		);
		expect(calls.sort).toEqual(["directive"]);
	});

	test("the filter box reports what was typed", async () => {
		const calls = draw();
		await userEvent.type(screen.getByRole("searchbox"), "test");
		expect(calls.q.join("")).toBe("test");
	});

	test("Create rules PR is offered for a draft-only selection", async () => {
		const calls = draw();
		await userEvent.click(
			screen.getByRole("checkbox", { name: /select all/i }),
		);
		await userEvent.click(
			screen.getByRole("button", { name: /create rules pr \(1\)/i }),
		);
		expect(calls.promote).toEqual([["ru_1"]]);
	});

	test("Create rules PR is refused when the selection is not all drafts", async () => {
		draw({
			rules: [
				rule(),
				rule({ id: "ru_2", status: "proposed", promotion_id: "pm_1" }),
			],
		});
		await userEvent.click(
			screen.getByRole("checkbox", { name: /select all/i }),
		);
		const button = screen.getByRole("button", {
			name: /create rules pr \(2\)/i,
		});
		expect((button as HTMLButtonElement).disabled).toBe(true);
		expect(screen.getByText(/only draft rules can be promoted/i)).toBeDefined();
		expect(
			(
				screen.getByRole("button", {
					name: /mark verified/i,
				}) as HTMLButtonElement
			).disabled,
		).toBe(true);
	});

	test("Abandon works on any live selection", async () => {
		const calls = draw();
		await userEvent.click(
			screen.getByRole("checkbox", { name: /select all/i }),
		);
		await userEvent.click(screen.getByRole("button", { name: /^abandon$/i }));
		expect(calls.abandon).toEqual([["ru_1"]]);
	});

	test("Mark verified is offered only for a proposed selection", async () => {
		const calls = draw({
			rules: [rule({ status: "proposed", promotion_id: "pm_1" })],
		});
		await userEvent.click(
			screen.getByRole("checkbox", { name: /select all/i }),
		);
		await userEvent.click(
			screen.getByRole("button", { name: /mark verified/i }),
		);
		expect(calls.verify).toEqual([["ru_1"]]);
	});

	test("Mark verified is disabled for a draft selection", async () => {
		draw();
		await userEvent.click(
			screen.getByRole("checkbox", { name: /select all/i }),
		);
		expect(
			(
				screen.getByRole("button", {
					name: /mark verified/i,
				}) as HTMLButtonElement
			).disabled,
		).toBe(true);
	});

	test("clicking the directive opens the drawer", async () => {
		const calls = draw();
		await userEvent.click(
			screen.getByRole("button", {
				name: "Always add a regression test alongside a bug fix.",
			}),
		);
		expect(calls.opened).toEqual(["ru_1"]);
	});
});
