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

function build(overrides: Partial<Props> = {}) {
	const calls = {
		analysed: [] as string[][],
		cancelled: [] as string[][],
		cancelledAll: 0,
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
		onCancel: (ids) => calls.cancelled.push(ids),
		onCancelAll: () => {
			calls.cancelledAll++;
		},
		loading: false,
		...overrides,
	};
	return { calls, props };
}

function draw(overrides: Partial<Props> = {}) {
	const { calls, props } = build(overrides);
	render(<EntriesTable {...props} />);
	return calls;
}

/** `draw`, plus the ability to hand the table a new set of props. */
function drawAgain(overrides: Partial<Props> = {}) {
	const { calls, props } = build(overrides);
	const { rerender } = render(<EntriesTable {...props} />);
	return {
		calls,
		update: (next: Partial<Props>) =>
			rerender(<EntriesTable {...props} {...next} />),
	};
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
			within(dialog).getByRole("button", { name: /^analyse$/i }),
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
			within(dialog).getByRole("button", { name: /^analyse$/i }),
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

	test("a failed entry keeps its error out of the row and still offers Analyse", async () => {
		const calls = draw({
			entries: [
				entry({
					analysis_state: "failed",
					last_error: "claude exited with code 1: model overloaded",
				}),
			],
		});
		// The stored error is server text of unbounded length. It belongs to
		// the drawer, which has room for it; a row that grows to fit it stops
		// being a row.
		expect(screen.queryByText(/model overloaded/)).toBeNull();
		// No drafts on this entry, so the guard has nothing to confirm and the
		// row action re-runs analysis in one click.
		await userEvent.click(
			screen.getByRole("button", { name: /^analyse #4821$/i }),
		);
		expect(calls.analysed).toEqual([["e_1"]]);
	});

	test("a failed entry's status pill opens the drawer", async () => {
		const calls = draw({
			entries: [
				entry({
					analysis_state: "failed",
					last_error: "claude exited with code 1: model overloaded",
				}),
			],
		});
		await userEvent.click(
			screen.getByRole("button", { name: "Open #4821 — analysis failed" }),
		);
		expect(calls.opened).toEqual(["e_1"]);
	});

	test("a status pill with nothing behind it is not a button", () => {
		draw({ entries: [entry({ analysis_state: "unanalysed" })] });
		// Only a failure has a reason to read about, so only a failure earns
		// the affordance. A column of pills that all invite a click and mostly
		// answer nothing is worse than a column of labels.
		expect(screen.queryByRole("button", { name: /^open #4821/i })).toBeNull();
		// Lowercase matches the pill and not the filter chip, which titles it.
		expect(screen.getByText("unanalysed").tagName).toBe("SPAN");
	});

	test("re-running a failed entry with drafts confirms the count first", async () => {
		// A re-analysis that fails leaves the previous run's drafts in place
		// (src/core/analysis/index.ts), so a failed entry can still carry
		// draft_rule_count > 0. A row action on a failed entry is a
		// re-analysis too, so it must not bypass the discard-count guard.
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
		await userEvent.click(
			screen.getByRole("button", { name: /^analyse #4821$/i }),
		);
		// Nothing has been sent yet.
		expect(calls.analysed).toEqual([]);
		const dialog = screen.getByRole("dialog");
		expect(
			within(dialog).getByText(
				"This will discard 2 draft rules and re-run analysis.",
			),
		).toBeDefined();
		await userEvent.click(
			within(dialog).getByRole("button", { name: /^analyse$/i }),
		);
		expect(calls.analysed).toEqual([["e_1"]]);
	});

	/**
	 * The rule this table exists to keep: a bulk action acts on what the user
	 * can see, and nothing else. Both halves are checked — the selection is
	 * dropped when the row set changes, and while it is held it is judged as a
	 * whole rather than by the slice that happens to be on screen.
	 */
	test("a selection hidden by a filter change is not acted on", async () => {
		const analysed = entry({
			analysis_state: "analysed",
			rule_count: 3,
			draft_rule_count: 3,
		});
		const unanalysed = entry({ id: "e_2", number: 4822 });
		const { calls, update } = drawAgain({ entries: [analysed, unanalysed] });

		await userEvent.click(
			screen.getByRole("checkbox", { name: /select all/i }),
		);
		expect(screen.getByText("2 selected")).toBeDefined();

		// The user switches the chip to "Unanalysed": the analysed row, with its
		// three drafts, is no longer on screen.
		update({ state: "unanalysed", entries: [unanalysed] });

		expect(screen.getByText("0 selected")).toBeDefined();
		const button = screen.getByRole("button", { name: /analyse selected/i });
		expect((button as HTMLButtonElement).disabled).toBe(true);
		await userEvent.click(button);
		expect(calls.analysed).toEqual([]);
		expect(screen.queryByRole("dialog")).toBeNull();
	});

	test("a selected row that leaves the list still counts its drafts", async () => {
		// A refetch — an SSE invalidation, not a filter change — can drop a
		// selected row from the visible slice. The selection survives that, so
		// the discard confirmation has to keep counting it.
		const analysed = entry({
			analysis_state: "analysed",
			rule_count: 3,
			draft_rule_count: 3,
		});
		const other = entry({ id: "e_2", number: 4822 });
		const { calls, update } = drawAgain({ entries: [analysed, other] });

		await userEvent.click(
			screen.getByRole("checkbox", { name: /select #4821/i }),
		);
		update({ entries: [other] });

		expect(screen.getByText("1 selected")).toBeDefined();
		await userEvent.click(
			screen.getByRole("button", { name: /analyse selected \(1\)/i }),
		);
		// Nothing has been sent: the drafts are confirmed first, and counted.
		expect(calls.analysed).toEqual([]);
		expect(
			within(screen.getByRole("dialog")).getByText(
				"This will discard 3 draft rules and re-run analysis.",
			),
		).toBeDefined();
	});

	test("a mutation failure is shown verbatim in the toolbar", () => {
		draw({ error: "No entry with id e_9" });
		expect(screen.getByText("No entry with id e_9")).toBeDefined();
	});

	test("a truncated file list says so on the row", () => {
		draw({ entries: [entry({ paths_truncated: true })] });
		expect(screen.getByTitle(/more than 300 files/i)).toBeDefined();
	});

	test("the counter reports this repository's own analysis states", () => {
		draw({ counts: { ...counts, queued: 4, running: 2 } });
		const counter = screen.getByText(/2 running, 4 queued/);
		expect(counter.dataset.active).toBe("true");
	});

	test("an idle counter stays mounted so the toolbar does not reflow", () => {
		draw();
		const counter = screen.getByText(/0 running, 0 queued/);
		expect(counter.dataset.active).toBe("false");
	});

	/**
	 * One verb, one shape: every row offers the same Analyse action whatever
	 * its state, rather than a bare button on a failed row, a ⋯ menu on an
	 * analysed one, and nothing at all on an unanalysed one. It is named for its
	 * entry so five of them do not share one accessible name. Queued and running
	 * rows carry it too, disabled — covered separately below.
	 */
	test("every actionable row offers Analyse, whatever its state", async () => {
		const calls = draw({
			entries: [
				entry(),
				entry({ id: "e_2", number: 4822, analysis_state: "analysed" }),
				entry({ id: "e_3", number: 4823, analysis_state: "failed" }),
			],
		});
		// No menu to open first: the button is on the row.
		await userEvent.click(
			screen.getByRole("button", { name: /^analyse #4821$/i }),
		);
		await userEvent.click(
			screen.getByRole("button", { name: /^analyse #4822$/i }),
		);
		await userEvent.click(
			screen.getByRole("button", { name: /^analyse #4823$/i }),
		);
		expect(calls.analysed).toEqual([["e_1"], ["e_2"], ["e_3"]]);
	});

	/**
	 * `queueEntries` already refuses to double-queue a busy entry and reports it
	 * as skipped, so these rules are about not offering a button that does
	 * nothing — not about protecting the queue.
	 */
	test("a queued or running row cannot be queued again", () => {
		draw({
			entries: [
				entry({ analysis_state: "queued" }),
				entry({ id: "e_2", number: 4822, analysis_state: "running" }),
				entry({ id: "e_3", number: 4823, analysis_state: "analysed" }),
			],
		});
		const busy = (number: number) =>
			screen.getByRole("button", {
				name: new RegExp(`^analyse #${number}$`, "i"),
			}) as HTMLButtonElement;
		expect(busy(4821).disabled).toBe(true);
		expect(busy(4822).disabled).toBe(true);
		expect(busy(4823).disabled).toBe(false);
	});

	test("Analyse selected goes down when the whole selection is already busy", async () => {
		const calls = draw({
			entries: [
				entry({ analysis_state: "queued" }),
				entry({ id: "e_2", number: 4822, analysis_state: "running" }),
			],
		});
		await userEvent.click(
			screen.getByRole("checkbox", { name: /select all/i }),
		);
		const button = screen.getByRole("button", {
			name: /analyse selected \(2\)/i,
		}) as HTMLButtonElement;
		expect(button.disabled).toBe(true);
		await userEvent.click(button);
		expect(calls.analysed).toEqual([]);
	});

	test("Analyse selected stays live while any of the selection is actionable", async () => {
		// Select-all must keep working: the server skips the busy ids for us.
		const calls = draw({
			entries: [
				entry({ analysis_state: "running" }),
				entry({ id: "e_2", number: 4822, analysis_state: "unanalysed" }),
			],
		});
		await userEvent.click(
			screen.getByRole("checkbox", { name: /select all/i }),
		);
		await userEvent.click(
			screen.getByRole("button", { name: /analyse selected \(2\)/i }),
		);
		expect(calls.analysed).toEqual([["e_1", "e_2"]]);
	});

	/**
	 * Without this the busy rule is unenforceable on the bulk button. The
	 * rows it just queued leave the visible slice (they no longer match an
	 * "unanalysed" chip), so `allBusy` falls back to the remembered rows, whose
	 * `analysis_state` is frozen at selection time and still reads unanalysed —
	 * leaving a live "Analyse selected (2)" whose every click is a no-op.
	 */
	test("dispatching the selection clears it", async () => {
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
		expect(screen.getByText("0 selected")).toBeDefined();
		expect(
			(
				screen.getByRole("button", {
					name: /analyse selected \(0\)/i,
				}) as HTMLButtonElement
			).disabled,
		).toBe(true);
	});

	test("the confirmed dialog clears the selection it was raised for", async () => {
		const calls = draw({
			entries: [entry({ analysis_state: "analysed", draft_rule_count: 2 })],
		});
		await userEvent.click(
			screen.getByRole("checkbox", { name: /select all/i }),
		);
		await userEvent.click(
			screen.getByRole("button", { name: /analyse selected \(1\)/i }),
		);
		await userEvent.click(
			within(screen.getByRole("dialog")).getByRole("button", {
				name: /^analyse$/i,
			}),
		);
		expect(calls.analysed).toEqual([["e_1"]]);
		expect(screen.getByText("0 selected")).toBeDefined();
	});

	test("a row's own Analyse leaves the selection alone", async () => {
		// Clearing here would throw away a selection the user is still building.
		const calls = draw({
			entries: [entry(), entry({ id: "e_2", number: 4822 })],
		});
		await userEvent.click(
			screen.getByRole("checkbox", { name: /select all/i }),
		);
		await userEvent.click(
			screen.getByRole("button", { name: /^analyse #4821$/i }),
		);
		expect(calls.analysed).toEqual([["e_1"]]);
		expect(screen.getByText("2 selected")).toBeDefined();
	});

	test("clicking the title opens the drawer", async () => {
		const calls = draw();
		await userEvent.click(
			screen.getByRole("button", { name: "Fix rounding in payments" }),
		);
		expect(calls.opened).toEqual(["e_1"]);
	});
});

describe("stopping an analysis", () => {
	test("only a busy row offers a live Stop, and it never replaces Analyse", () => {
		draw({
			entries: [
				entry({ analysis_state: "queued" }),
				entry({ id: "e_2", number: 4822, analysis_state: "running" }),
				entry({ id: "e_3", number: 4823, analysis_state: "analysed" }),
			],
		});
		const stop = (number: number) =>
			screen.getByRole("button", {
				name: new RegExp(`^stop analysing #${number}$`, "i"),
			}) as HTMLButtonElement;

		expect(stop(4821).disabled).toBe(false);
		expect(stop(4822).disabled).toBe(false);
		expect(stop(4823).disabled).toBe(true);
		// Both controls are present in every state: a verb that changes under
		// the pointer is what the pair exists to avoid.
		expect(
			screen.getByRole("button", { name: /^analyse #4821$/i }),
		).toBeTruthy();
	});

	test("a row's Stop sends only that row", async () => {
		const calls = draw({
			entries: [
				entry({ analysis_state: "running" }),
				entry({ id: "e_2", number: 4822, analysis_state: "running" }),
			],
		});
		await userEvent.click(
			screen.getByRole("button", { name: /^stop analysing #4822$/i }),
		);
		expect(calls.cancelled).toEqual([["e_2"]]);
	});

	test("Stop selected stays live while any of the selection is busy", async () => {
		const calls = draw({
			entries: [
				entry({ analysis_state: "running" }),
				entry({ id: "e_2", number: 4822, analysis_state: "analysed" }),
			],
		});
		await userEvent.click(screen.getAllByRole("checkbox")[1] as HTMLElement);
		await userEvent.click(screen.getAllByRole("checkbox")[2] as HTMLElement);

		const stop = screen.getByRole("button", {
			name: /^stop selected/i,
		}) as HTMLButtonElement;
		expect(stop.disabled).toBe(false);
		// The mixed selection goes whole: the server skips what it cannot stop.
		await userEvent.click(stop);
		expect(calls.cancelled).toEqual([["e_1", "e_2"]]);
	});

	test("Stop selected goes down when nothing in the selection is busy", async () => {
		draw({ entries: [entry({ analysis_state: "analysed" })] });
		await userEvent.click(screen.getAllByRole("checkbox")[1] as HTMLElement);

		expect(
			(
				screen.getByRole("button", {
					name: /^stop selected/i,
				}) as HTMLButtonElement
			).disabled,
		).toBe(true);
	});

	test("dispatching a stop clears the selection it was raised for", async () => {
		draw({ entries: [entry({ analysis_state: "running" })] });
		await userEvent.click(screen.getAllByRole("checkbox")[1] as HTMLElement);
		await userEvent.click(
			screen.getByRole("button", { name: /^stop selected/i }),
		);

		// Stopped rows leave the Queued and Running chips, so a selection kept
		// here would point at ids no longer on screen.
		expect(screen.getByText("0 selected")).toBeTruthy();
	});

	test("Stop all goes down when the counter it sits beside reads zero", () => {
		draw({ counts: { ...counts, running: 0, queued: 0 } });
		expect(
			(
				screen.getByRole("button", {
					name: /^stop all$/i,
				}) as HTMLButtonElement
			).disabled,
		).toBe(true);
	});

	test("Stop all sweeps the repository, not the selection", async () => {
		const calls = draw({ counts: { ...counts, running: 1, queued: 2 } });
		await userEvent.click(screen.getByRole("button", { name: /^stop all$/i }));

		expect(calls.cancelledAll).toBe(1);
		expect(calls.cancelled).toEqual([]);
	});
});
