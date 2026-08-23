import { describe, expect, test } from "bun:test";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { EntryCounts, EntrySummary } from "../../src/shared/api.ts";
import { EntriesTable } from "../../web/src/components/EntriesTable.tsx";

const counts: EntryCounts = {
	total: 3,
	unanalysed: 1,
	queued: 0,
	running: 0,
	analysed: 1,
	failed: 1,
};

function entry(overrides: Partial<EntrySummary> = {}): EntrySummary {
	return {
		id: "e_1",
		repo_id: "r_1",
		number: 4821,
		title: "Fix rounding in payments",
		author: "dana",
		url: "https://github.com/acme/mono/pull/4821",
		merged_at: "2026-08-20T10:00:00.000Z",
		updated_at: "2026-08-21T10:00:00.000Z",
		matched_prefix: "services/payments/**",
		changed_file_count: 3,
		comment_count: 7,
		paths_truncated: false,
		analysis_state: "unanalysed",
		analysed_at: null,
		last_error: null,
		rule_count: 0,
		draft_rule_count: 0,
		...overrides,
	};
}

type Props = Parameters<typeof EntriesTable>[0];

function draw(overrides: Partial<Props> = {}) {
	const calls = {
		analysed: [] as string[][],
		all: 0,
		state: [] as string[],
		q: [] as string[],
		opened: [] as string[],
	};
	const props: Props = {
		entries: [entry()],
		counts,
		state: "",
		onStateChange: (next) => calls.state.push(next),
		query: "",
		onQueryChange: (next) => calls.q.push(next),
		onOpenEntry: (id) => calls.opened.push(id),
		onAnalyse: (ids) => calls.analysed.push(ids),
		onAnalyseAllUnanalysed: () => {
			calls.all++;
		},
		batch: { queued: 0, running: 0 },
		loading: false,
		...overrides,
	};
	render(<EntriesTable {...props} />);
	return calls;
}

describe("EntriesTable", () => {
	test("renders a row with its PR number, matched prefix, and counts", () => {
		draw();
		expect(screen.getByText("#4821")).toBeDefined();
		expect(screen.getByText("Fix rounding in payments")).toBeDefined();
		expect(screen.getByText(/services\/payments\/\*\*/)).toBeDefined();
		expect(screen.getByText("3")).toBeDefined();
		expect(screen.getByText("7")).toBeDefined();
		expect(screen.getByText("dana")).toBeDefined();
		expect(screen.getByText("2026-08-20")).toBeDefined();
	});

	test("filter chips carry counts and report the chosen state", async () => {
		const calls = draw();
		expect(screen.getByRole("button", { name: "Failed 1" })).toBeDefined();
		await userEvent.click(screen.getByRole("button", { name: "Unanalysed 1" }));
		expect(calls.state).toEqual(["unanalysed"]);
	});

	test("the search box reports what was typed", async () => {
		const calls = draw();
		await userEvent.type(screen.getByRole("searchbox"), "pay");
		expect(calls.q.join("")).toBe("pay");
	});

	test("selecting rows enables Analyse selected and passes their ids", async () => {
		const calls = draw({
			entries: [entry(), entry({ id: "e_2", number: 4822 })],
		});
		await userEvent.click(
			screen.getByRole("checkbox", { name: /select all/i }),
		);
		await userEvent.click(
			screen.getByRole("button", { name: /analyse selected \(2\)/i }),
		);
		expect(calls.analysed).toEqual([["e_1", "e_2"]]);
	});

	test("re-analysing entries with drafts confirms the count first", async () => {
		const calls = draw({
			entries: [
				entry({
					analysis_state: "analysed",
					rule_count: 3,
					draft_rule_count: 3,
				}),
			],
		});
		await userEvent.click(
			screen.getByRole("checkbox", { name: /select all/i }),
		);
		await userEvent.click(
			screen.getByRole("button", { name: /analyse selected \(1\)/i }),
		);
		// Nothing has been sent yet.
		expect(calls.analysed).toEqual([]);
		const dialog = screen.getByRole("dialog");
		expect(
			within(dialog).getByText(
				"This will discard 3 draft rules and re-run analysis.",
			),
		).toBeDefined();
		await userEvent.click(
			within(dialog).getByRole("button", { name: /^re-analyse$/i }),
		);
		expect(calls.analysed).toEqual([["e_1"]]);
	});

	test("bulk re-analysis names the combined draft count across the selection", async () => {
		const calls = draw({
			entries: [
				entry({
					analysis_state: "analysed",
					rule_count: 3,
					draft_rule_count: 3,
				}),
				entry({
					id: "e_2",
					number: 4822,
					analysis_state: "analysed",
					rule_count: 2,
					draft_rule_count: 2,
				}),
			],
		});
		await userEvent.click(
			screen.getByRole("checkbox", { name: /select all/i }),
		);
		await userEvent.click(
			screen.getByRole("button", { name: /analyse selected \(2\)/i }),
		);
		expect(calls.analysed).toEqual([]);
		const dialog = screen.getByRole("dialog");
		expect(
			within(dialog).getByText(
				"This will discard 5 draft rules and re-run analysis.",
			),
		).toBeDefined();
		await userEvent.click(
			within(dialog).getByRole("button", { name: /^re-analyse$/i }),
		);
		expect(calls.analysed).toEqual([["e_1", "e_2"]]);
	});

	test("cancelling the confirmation sends nothing", async () => {
		const calls = draw({
			entries: [entry({ analysis_state: "analysed", draft_rule_count: 1 })],
		});
		await userEvent.click(
			screen.getByRole("checkbox", { name: /select all/i }),
		);
		await userEvent.click(
			screen.getByRole("button", { name: /analyse selected \(1\)/i }),
		);
		await userEvent.click(
			within(screen.getByRole("dialog")).getByRole("button", {
				name: /cancel/i,
			}),
		);
		expect(calls.analysed).toEqual([]);
	});

	test("a failed entry shows its stored error and a Retry action", async () => {
		const calls = draw({
			entries: [
				entry({
					analysis_state: "failed",
					last_error: "claude exited with code 1: model overloaded",
				}),
			],
		});
		expect(
			screen.getByText(/claude exited with code 1: model overloaded/),
		).toBeDefined();
		// No drafts on this entry, so the guard has nothing to confirm and
		// Retry re-runs analysis in one click.
		await userEvent.click(screen.getByRole("button", { name: /^retry$/i }));
		expect(calls.analysed).toEqual([["e_1"]]);
	});

	test("Retry on a failed entry with drafts confirms the count first", async () => {
		// A re-analysis that fails leaves the previous run's drafts in place
		// (src/core/analysis/index.ts), so a failed entry can still carry
		// draft_rule_count > 0. Retry is a re-analysis too, so it must not
		// bypass the discard-count guard.
		const calls = draw({
			entries: [
				entry({
					analysis_state: "failed",
					last_error: "claude exited with code 1: model overloaded",
					rule_count: 2,
					draft_rule_count: 2,
				}),
			],
		});
		await userEvent.click(screen.getByRole("button", { name: /^retry$/i }));
		// Nothing has been sent yet.
		expect(calls.analysed).toEqual([]);
		const dialog = screen.getByRole("dialog");
		expect(
			within(dialog).getByText(
				"This will discard 2 draft rules and re-run analysis.",
			),
		).toBeDefined();
		await userEvent.click(
			within(dialog).getByRole("button", { name: /^re-analyse$/i }),
		);
		expect(calls.analysed).toEqual([["e_1"]]);
	});

	test("a truncated file list says so on the row", () => {
		draw({ entries: [entry({ paths_truncated: true })] });
		expect(screen.getByTitle(/more than 300 files/i)).toBeDefined();
	});

	test("live batch progress appears while work is in flight", () => {
		draw({ batch: { queued: 4, running: 2 } });
		expect(screen.getByText(/2 running, 4 queued/)).toBeDefined();
	});

	test("Analyse all unanalysed is offered with its count", async () => {
		const calls = draw();
		await userEvent.click(
			screen.getByRole("button", { name: /analyse all 1 unanalysed/i }),
		);
		expect(calls.all).toBe(1);
	});

	test("clicking the title opens the drawer", async () => {
		const calls = draw();
		await userEvent.click(
			screen.getByRole("button", { name: "Fix rounding in payments" }),
		);
		expect(calls.opened).toEqual(["e_1"]);
	});
});
