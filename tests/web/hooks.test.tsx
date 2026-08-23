import { afterEach, describe, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type {
	AnalysisState,
	EntryDetail,
	RuleDetail,
	RuleStatus,
} from "../../src/shared/api.ts";
import {
	useAnalyse,
	useEntry,
	useRule,
	useSetRuleStatus,
} from "../../web/src/api/hooks.ts";

const original = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = original;
});

/**
 * A detail query and a mutation, mounted together — the shape Task 15's rule
 * drawer takes. The drawer stays mounted across the mutation and
 * `refetchOnWindowFocus` is off, so an invalidation that misses the detail
 * family leaves stale text on screen forever.
 */
function ruleDetail(status: RuleStatus): RuleDetail {
	return {
		id: "r1",
		repo_id: "repo1",
		entry_id: "e1",
		kind: "do",
		directive: "Name the boundary",
		rationale: "because",
		scope_globs: ["src/**"],
		confidence: 0.9,
		source_comment_urls: [],
		status,
		promotion_id: null,
		file_slug: "name-the-boundary",
		created_at: "2026-08-23T00:00:00.000Z",
		status_changed_at: "2026-08-23T00:00:00.000Z",
		source_number: 7,
		source_url: "https://example.invalid/pull/7",
		file_path: "docs/rules/name-the-boundary.md",
		file_preview: "# Name the boundary\n",
	};
}

function entryDetail(state: AnalysisState): EntryDetail {
	return {
		id: "e1",
		repo_id: "repo1",
		number: 7,
		title: "A pull request",
		author: "someone",
		url: "https://example.invalid/pull/7",
		merged_at: "2026-08-23T00:00:00.000Z",
		updated_at: "2026-08-23T00:00:00.000Z",
		matched_prefix: "src/",
		changed_file_count: 1,
		comment_count: 0,
		paths_truncated: false,
		analysis_state: state,
		analysed_at: null,
		last_error: null,
		rule_count: 0,
		draft_rule_count: 0,
		body: "",
		labels: [],
		changed_paths: ["src/a.ts"],
		conversation_truncated: false,
		reviews: [],
		review_threads: [],
		comments: [],
		rules: [],
	};
}

/**
 * One client per test, created outside the render tree: a client constructed
 * inline in JSX would be replaced on every re-render, and the fresh cache would
 * hide the very refetch these tests are asserting on.
 */
function client(): QueryClient {
	return new QueryClient({
		defaultOptions: {
			queries: { retry: false },
			mutations: { retry: false },
		},
	});
}

function RuleDrawer() {
	const rule = useRule("r1");
	const setStatus = useSetRuleStatus();
	return (
		<div>
			<span data-testid="status">{rule.data?.status ?? "loading"}</span>
			<button
				type="button"
				onClick={() =>
					setStatus.mutate({ ruleIds: ["r1"], status: "abandoned" })
				}
			>
				abandon
			</button>
		</div>
	);
}

function EntryDrawer() {
	const entry = useEntry("e1");
	const analyse = useAnalyse();
	return (
		<div>
			<span data-testid="state">{entry.data?.analysis_state ?? "loading"}</span>
			<button type="button" onClick={() => analyse.mutate(["e1"])}>
				analyse
			</button>
		</div>
	);
}

describe("mutation invalidation reaches the detail queries", () => {
	test("setting a rule's status refetches an open rule detail", async () => {
		let status: RuleStatus = "draft";
		globalThis.fetch = ((input: unknown) => {
			const path = String(input);
			if (path === "/api/rules/status") {
				status = "abandoned";
				return Promise.resolve(Response.json([]));
			}
			if (path === "/api/rules/r1") {
				return Promise.resolve(Response.json(ruleDetail(status)));
			}
			return Promise.resolve(
				new Response(`unexpected ${path}`, { status: 404 }),
			);
		}) as typeof fetch;

		const queries = client();
		render(
			<QueryClientProvider client={queries}>
				<RuleDrawer />
			</QueryClientProvider>,
		);

		await waitFor(() =>
			expect(screen.getByTestId("status").textContent).toBe("draft"),
		);
		fireEvent.click(screen.getByRole("button", { name: "abandon" }));
		await waitFor(() =>
			expect(screen.getByTestId("status").textContent).toBe("abandoned"),
		);
	});

	test("queueing an analysis refetches an open entry detail", async () => {
		let state: AnalysisState = "unanalysed";
		globalThis.fetch = ((input: unknown) => {
			const path = String(input);
			if (path === "/api/entries/analyse") {
				state = "queued";
				return Promise.resolve(Response.json({ queued: ["e1"], skipped: [] }));
			}
			if (path === "/api/entries/e1") {
				return Promise.resolve(Response.json(entryDetail(state)));
			}
			return Promise.resolve(
				new Response(`unexpected ${path}`, { status: 404 }),
			);
		}) as typeof fetch;

		const queries = client();
		render(
			<QueryClientProvider client={queries}>
				<EntryDrawer />
			</QueryClientProvider>,
		);

		await waitFor(() =>
			expect(screen.getByTestId("state").textContent).toBe("unanalysed"),
		);
		fireEvent.click(screen.getByRole("button", { name: "analyse" }));
		await waitFor(() =>
			expect(screen.getByTestId("state").textContent).toBe("queued"),
		);
	});
});
