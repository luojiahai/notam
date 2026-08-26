import { describe, expect, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { RuleSummary } from "../../src/shared/api.ts";
import { RulesTable } from "../../web/src/components/RulesTable.tsx";

function rule(overrides: Partial<RuleSummary> = {}): RuleSummary {
	return {
		id: "ru_1",
		repo_id: "r_1",
		entry_id: "e_1",
		type: "testing",
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

function build(overrides: Partial<Props> = {}) {
	const calls = {
		abandon: [] as string[][],
		promote: [] as string[][],
		q: [] as string[],
		opened: [] as string[],
	};
	const props: Props = {
		rules: [rule()],
		query: "",
		onQueryChange: (next) => calls.q.push(next),
		onOpenRule: (id) => calls.opened.push(id),
		selection: {
			onAbandon: (ids) => calls.abandon.push(ids),
			onCreatePromotion: (ids) => calls.promote.push(ids),
		},
		loading: false,
		emptyTitle: "No drafts.",
		emptyHint: "Analyse some sources.",
		...overrides,
	};
	return { calls, props };
}

function draw(overrides: Partial<Props> = {}) {
	const { calls, props } = build(overrides);
	render(<RulesTable {...props} />);
	return calls;
}

/** `draw`, plus the ability to hand the table a new set of props. */
function drawAgain(overrides: Partial<Props> = {}) {
	const { calls, props } = build(overrides);
	const { rerender } = render(<RulesTable {...props} />);
	return {
		calls,
		update: (next: Partial<Props>) =>
			rerender(<RulesTable {...props} {...next} />),
	};
}

describe("RulesTable", () => {
	test("renders the type badge, directive, rationale, scope, confidence, and source", () => {
		draw();
		expect(screen.getByText("testing")).toBeDefined();
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
	});

	test("Abandon works on any live selection", async () => {
		const calls = draw();
		await userEvent.click(
			screen.getByRole("checkbox", { name: /select all/i }),
		);
		await userEvent.click(screen.getByRole("button", { name: /^abandon$/i }));
		expect(calls.abandon).toEqual([["ru_1"]]);
	});

	/**
	 * `abandoned` is terminal in the state machine, so the stage that lists
	 * those rules offers nothing to do with them. A checkbox column that enables
	 * no action reads as a broken one.
	 */
	test("a stage with no selection renders neither checkboxes nor actions", () => {
		draw({
			rules: [rule({ status: "abandoned" })],
			selection: undefined,
		});
		expect(screen.queryByRole("checkbox")).toBeNull();
		expect(screen.queryByRole("button", { name: /^abandon$/i })).toBeNull();
		expect(
			screen.queryByRole("button", { name: /create rules pr/i }),
		).toBeNull();
	});

	/**
	 * Abandon is terminal (`LEGAL_TRANSITIONS.abandoned = []`) and the product
	 * has no undo, so it is the one action that must never reach a row the user
	 * cannot see. Both halves are checked: the selection is dropped when the
	 * row set changes, and while it is held it is judged as a whole rather than
	 * by the slice that happens to be on screen.
	 */
	test("a selection hidden by a search is not acted on", async () => {
		const draft = rule();
		const other = rule({ id: "ru_2", directive: "Prefer explicit timeouts." });
		const { calls, update } = drawAgain({ rules: [draft, other] });

		await userEvent.click(
			screen.getByRole("checkbox", { name: /select all/i }),
		);
		expect(screen.getByText("2 selected")).toBeDefined();

		// The user narrows the search: the second rule is gone from the screen,
		// and so must be gone from anything Abandon would send.
		update({ query: "regression", rules: [draft] });

		expect(screen.getByText("0 selected")).toBeDefined();
		const abandon = screen.getByRole("button", { name: /^abandon$/i });
		expect((abandon as HTMLButtonElement).disabled).toBe(true);
		await userEvent.click(abandon);
		expect(calls.abandon).toEqual([]);
	});

	test("a selected abandoned rule that leaves the list still blocks Abandon", async () => {
		// A refetch — an SSE invalidation, not a search change — can drop a
		// selected row from the visible slice. Deriving the guard from the
		// visible rows alone would leave Abandon enabled and fire it on an id
		// nothing on screen accounts for.
		const abandoned = rule({ id: "ru_9", status: "abandoned" });
		const { calls, update } = drawAgain({ rules: [abandoned] });

		await userEvent.click(
			screen.getByRole("checkbox", { name: /select all/i }),
		);
		update({ rules: [] });

		expect(screen.getByText("1 selected")).toBeDefined();
		const abandon = screen.getByRole("button", { name: /^abandon$/i });
		expect((abandon as HTMLButtonElement).disabled).toBe(true);
		await userEvent.click(abandon);
		expect(calls.abandon).toEqual([]);
	});

	test("a rejected transition is shown verbatim in the bulk bar", () => {
		draw({ error: "draft cannot become verified" });
		expect(screen.getByText("draft cannot become verified")).toBeDefined();
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

	test("an empty stage says which nothing it is", () => {
		draw({ rules: [], emptyTitle: "No drafts.", emptyHint: "Analyse some." });
		expect(screen.getByText("No drafts.")).toBeDefined();
		expect(screen.getByText("Analyse some.")).toBeDefined();
	});
});
