import { describe, expect, test } from "bun:test";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { EntryDetail } from "../../src/shared/api.ts";
import { EntryDrawerView } from "../../web/src/components/EntryDrawer.tsx";

const url = "https://github.com/acme/mono/pull/4821";

function detail(overrides: Partial<EntryDetail> = {}): EntryDetail {
	return {
		id: "e_1",
		repo_id: "r_1",
		number: 4821,
		title: "Fix rounding in payments",
		author: "dana",
		url,
		merged_at: "2026-08-20T10:00:00.000Z",
		updated_at: "2026-08-21T10:00:00.000Z",
		matched_prefix: "services/payments/**",
		changed_file_count: 1,
		comment_count: 3,
		paths_truncated: false,
		analysis_state: "analysed",
		analysed_at: "2026-08-23T09:00:00.000Z",
		last_error: null,
		rule_count: 1,
		draft_rule_count: 1,
		body: "Rounds half-up instead of half-even.",
		labels: ["bug"],
		changed_paths: ["services/payments/round.ts"],
		conversation_truncated: false,
		reviews: [
			{
				author: "sam",
				state: "CHANGES_REQUESTED",
				body: "Needs a regression test.",
				url: `${url}#pullrequestreview-1`,
				submitted_at: "2026-08-20T09:00:00.000Z",
			},
		],
		review_threads: [
			{
				path: "services/payments/round.ts",
				line: 42,
				resolved: true,
				comments: [
					{
						author: "sam",
						body: "Please add one.",
						url: `${url}#discussion_r1`,
						created_at: "2026-08-20T09:00:00.000Z",
					},
				],
			},
		],
		comments: [
			{
				author: "dana",
				body: "Added the test.",
				url: `${url}#issuecomment-1`,
				created_at: "2026-08-20T09:30:00.000Z",
			},
		],
		rules: [
			{
				id: "ru_1",
				repo_id: "r_1",
				entry_id: "e_1",
				type: "testing",
				directive: "Always add a regression test alongside a bug fix.",
				rationale: "Reviewers blocked untested fixes.",
				scope_globs: ["services/payments/**"],
				confidence: 0.9,
				source_comment_urls: [],
				status: "draft",
				promotion_id: null,
				file_slug: "always-add-a-regression-test",
				created_at: "2026-08-23T09:00:00.000Z",
				status_changed_at: "2026-08-23T09:00:00.000Z",
				source_number: 4821,
				source_url: url,
			},
		],
		...overrides,
	};
}

describe("EntryDrawerView", () => {
	test("shows the PR body, the threads with anchors, and the issue comments", () => {
		render(
			<EntryDrawerView
				entry={detail()}
				onReanalyse={() => {}}
				onCancel={() => {}}
				onOpenRule={() => {}}
			/>,
		);
		expect(
			screen.getByText("Rounds half-up instead of half-even."),
		).toBeDefined();
		expect(screen.getByText("services/payments/round.ts:42")).toBeDefined();
		expect(screen.getByText("Please add one.")).toBeDefined();
		expect(screen.getByText("Needs a regression test.")).toBeDefined();
		expect(screen.getByText("Added the test.")).toBeDefined();
	});

	test("lists the derived rules with their status and opens one on click", async () => {
		const opened: string[] = [];
		render(
			<EntryDrawerView
				entry={detail()}
				onReanalyse={() => {}}
				onCancel={() => {}}
				onOpenRule={(id) => opened.push(id)}
			/>,
		);
		expect(screen.getByText("draft")).toBeDefined();
		await userEvent.click(
			screen.getByRole("button", {
				name: "Always add a regression test alongside a bug fix.",
			}),
		);
		expect(opened).toEqual(["ru_1"]);
	});

	test("says so explicitly when the file list was truncated", () => {
		render(
			<EntryDrawerView
				entry={detail({ paths_truncated: true })}
				onReanalyse={() => {}}
				onCancel={() => {}}
				onOpenRule={() => {}}
			/>,
		);
		expect(screen.getByText(/changed more than 300 files/i)).toBeDefined();
	});

	test("says so when the conversation itself was capped", () => {
		render(
			<EntryDrawerView
				entry={detail({ conversation_truncated: true })}
				onReanalyse={() => {}}
				onCancel={() => {}}
				onOpenRule={() => {}}
			/>,
		);
		expect(screen.getByText(/conversation is truncated/i)).toBeDefined();
	});

	test("re-analysing from the drawer confirms the draft count first", async () => {
		let clicks = 0;
		render(
			<EntryDrawerView
				entry={detail()}
				onReanalyse={() => {
					clicks++;
				}}
				onCancel={() => {}}
				onOpenRule={() => {}}
			/>,
		);
		await userEvent.click(screen.getByRole("button", { name: /^analyse$/i }));
		expect(clicks).toBe(0);
		expect(
			screen.getByText("This will discard 1 draft rule and re-run analysis."),
		).toBeDefined();
		await userEvent.click(
			within(screen.getByRole("dialog")).getByRole("button", {
				name: /^analyse$/i,
			}),
		);
		expect(clicks).toBe(1);
	});

	test("with no drafts to lose, analysis fires straight away", async () => {
		let clicks = 0;
		render(
			<EntryDrawerView
				entry={detail({ rules: [], rule_count: 0, draft_rule_count: 0 })}
				onReanalyse={() => {
					clicks++;
				}}
				onCancel={() => {}}
				onOpenRule={() => {}}
			/>,
		);
		await userEvent.click(screen.getByRole("button", { name: /^analyse$/i }));
		expect(clicks).toBe(1);
	});

	test("a running entry cannot be queued again from the drawer", () => {
		render(
			<EntryDrawerView
				entry={detail({
					analysis_state: "running",
					rules: [],
					rule_count: 0,
					draft_rule_count: 0,
				})}
				onReanalyse={() => {}}
				onCancel={() => {}}
				onOpenRule={() => {}}
			/>,
		);
		const button = screen.getByRole("button", {
			name: /^analyse$/i,
		}) as HTMLButtonElement;
		expect(button.disabled).toBe(true);
	});

	test("a failed entry shows its error and offers Analyse", async () => {
		let clicks = 0;
		render(
			<EntryDrawerView
				entry={detail({
					analysis_state: "failed",
					last_error: "claude did not finish within 120000ms",
					rules: [],
					rule_count: 0,
					draft_rule_count: 0,
				})}
				onReanalyse={() => {
					clicks++;
				}}
				onCancel={() => {}}
				onOpenRule={() => {}}
			/>,
		);
		expect(screen.getByText(/did not finish within 120000ms/)).toBeDefined();
		await userEvent.click(screen.getByRole("button", { name: /^analyse$/i }));
		expect(clicks).toBe(1);
	});
	test("offers Stop beside Analyse, live only while the entry is busy", async () => {
		const stopped: number[] = [];
		render(
			<EntryDrawerView
				entry={detail({ analysis_state: "running" })}
				onReanalyse={() => {}}
				onCancel={() => stopped.push(1)}
				onOpenRule={() => {}}
			/>,
		);
		const analyse = screen.getByRole("button", {
			name: /^analyse$/i,
		}) as HTMLButtonElement;
		expect(analyse.disabled).toBe(true);

		await userEvent.click(screen.getByRole("button", { name: /^stop$/i }));
		expect(stopped).toEqual([1]);
	});

	test("takes Stop down for an entry with nothing running", () => {
		render(
			<EntryDrawerView
				entry={detail()}
				onReanalyse={() => {}}
				onCancel={() => {}}
				onOpenRule={() => {}}
			/>,
		);
		expect(
			(screen.getByRole("button", { name: /^stop$/i }) as HTMLButtonElement)
				.disabled,
		).toBe(true);
	});
});
