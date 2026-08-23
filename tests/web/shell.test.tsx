import { afterEach, describe, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import type {
	EntryDetail,
	PromotionSummary,
	RepoSummary,
	RuleDetail,
	RuleStatus,
	ServerEvent,
} from "../../src/shared/api.ts";
import { applyServerEvent, invalidationsFor } from "../../web/src/App.tsx";
import { useEntry, useRule } from "../../web/src/api/hooks.ts";
import { Sidebar } from "../../web/src/components/Sidebar.tsx";

const repo: RepoSummary = {
	id: "r_1",
	name: "acme/mono",
	host_id: "github",
	host_label: "GitHub",
	default_branch: "main",
	path_globs: ["services/payments/**"],
	window_days: 180,
	sync_watermark: null,
	entries: {
		total: 12,
		unanalysed: 7,
		queued: 0,
		running: 0,
		analysed: 4,
		failed: 1,
	},
	rules: { total: 9, draft: 5, proposed: 2, verified: 1, abandoned: 1 },
	open_promotions: 1,
};

const promotion: PromotionSummary = {
	id: "pm_1",
	repo_id: "r_1",
	branch: "notam/rules-20260823-abc123",
	pr_number: 900,
	pr_url: "https://github.com/acme/mono/pull/900",
	state: "open",
	created_at: "2026-08-23T09:00:00.000Z",
	last_checked_at: null,
	rule_count: 2,
};

function wrap(ui: ReactElement) {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	return render(
		<QueryClientProvider client={client}>{ui}</QueryClientProvider>,
	);
}

describe("Sidebar", () => {
	test("lists repositories with their entry counts", () => {
		wrap(
			<Sidebar
				repos={[repo]}
				promotions={[promotion]}
				selectedRepoId="r_1"
				onSelectRepo={() => {}}
				onRefreshPromotions={() => {}}
				refreshing={false}
			/>,
		);
		expect(screen.getByText("acme/mono")).toBeDefined();
		expect(screen.getByText(/12 entries/)).toBeDefined();
		expect(screen.getByText(/5 drafts/)).toBeDefined();
	});

	test("marks the selected repository and reports a click", async () => {
		const picked: string[] = [];
		wrap(
			<Sidebar
				repos={[repo, { ...repo, id: "r_2", name: "acme/api" }]}
				promotions={[]}
				selectedRepoId="r_1"
				onSelectRepo={(id) => picked.push(id)}
				onRefreshPromotions={() => {}}
				refreshing={false}
			/>,
		);
		expect(
			screen
				.getByRole("button", { name: /acme\/mono/ })
				.getAttribute("aria-current"),
		).toBe("true");
		await userEvent.click(screen.getByRole("button", { name: /acme\/api/ }));
		expect(picked).toEqual(["r_2"]);
	});

	test("shows each promotion with its state badge and a link to the PR", () => {
		wrap(
			<Sidebar
				repos={[repo]}
				promotions={[promotion]}
				selectedRepoId="r_1"
				onSelectRepo={() => {}}
				onRefreshPromotions={() => {}}
				refreshing={false}
			/>,
		);
		const link = screen.getByRole("link", { name: /#900/ });
		expect(link.getAttribute("href")).toBe(
			"https://github.com/acme/mono/pull/900",
		);
		expect(screen.getByText("open")).toBeDefined();
		expect(screen.getByText(/2 rules/)).toBeDefined();
	});

	test("the refresh button reports a click", async () => {
		let clicks = 0;
		wrap(
			<Sidebar
				repos={[repo]}
				promotions={[promotion]}
				selectedRepoId="r_1"
				onSelectRepo={() => {}}
				onRefreshPromotions={() => {
					clicks++;
				}}
				refreshing={false}
			/>,
		);
		await userEvent.click(
			screen.getByRole("button", { name: /refresh status/i }),
		);
		await waitFor(() => expect(clicks).toBe(1));
	});
});

function ruleDetail(status: RuleStatus): RuleDetail {
	return {
		id: "r1",
		repo_id: "r_1",
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

/** An entry detail whose embedded `rules[0]` carries the same status as `ruleDetail`. */
function entryDetailWithRule(status: RuleStatus): EntryDetail {
	return {
		id: "e1",
		repo_id: "r_1",
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
		analysis_state: "analysed",
		analysed_at: "2026-08-23T00:00:00.000Z",
		last_error: null,
		rule_count: 1,
		draft_rule_count: status === "draft" ? 1 : 0,
		body: "",
		labels: [],
		changed_paths: ["src/a.ts"],
		conversation_truncated: false,
		reviews: [],
		review_threads: [],
		comments: [],
		rules: [ruleDetail(status)],
	};
}

/**
 * `invalidationsFor` is the pure mapping from a server event to the query-key
 * families it must invalidate — the piece that grew three gaps across two
 * rounds of review because nothing exercised it directly. These assertions are
 * data-level: they check the mapping's output against the query-key families
 * without touching a QueryClient. The next block, `applyServerEvent`, covers
 * the "rules" case behaviourally (a mounted drawer actually refetching);
 * these cover the rest by asserting the mapping itself, once and for all
 * event shapes including the two the switch does not special-case
 * ("hello", "heartbeat").
 */
describe("invalidationsFor", () => {
	test("maps each server event to its query-key families", () => {
		const entryEvent: ServerEvent = {
			type: "entry",
			repo_id: "r_1",
			entry_id: "e_1",
			state: "analysed",
			error: null,
		};
		expect(invalidationsFor(entryEvent)).toEqual([
			["entries"],
			["entry", "e_1"],
			["repos"],
		]);

		const rulesEvent: ServerEvent = { type: "rules", repo_id: "r_1" };
		expect(invalidationsFor(rulesEvent)).toEqual([
			["rules"],
			["rule"],
			["entries"],
			["entry"],
			["repos"],
		]);

		const syncEvent: ServerEvent = {
			type: "sync",
			repo_id: "r_1",
			phase: "finished",
			created: 0,
			updated: 3,
			skipped: 0,
			error: null,
		};
		expect(invalidationsFor(syncEvent)).toEqual([
			["entries"],
			["entry"],
			["repos"],
		]);

		const promotionEvent: ServerEvent = {
			type: "promotion",
			repo_id: "r_1",
			promotion_id: "pm_1",
			state: "merged",
		};
		expect(invalidationsFor(promotionEvent)).toEqual([
			["promotions"],
			["rules"],
			["repos"],
		]);

		expect(invalidationsFor({ type: "batch", queued: 1, running: 2 })).toEqual(
			[],
		);
		expect(invalidationsFor({ type: "hello", version: "1.0.0" })).toEqual([]);
		expect(invalidationsFor({ type: "heartbeat" })).toEqual([]);
	});
});

/**
 * `useServerEvents` no-ops under happy-dom (it ships no `EventSource`), so
 * there is no live connection here to dispatch through. `applyServerEvent` is
 * called directly instead — exactly what `App`'s `useServerEvents` callback
 * does on a real message.
 */
describe("applyServerEvent", () => {
	const originalFetch = globalThis.fetch;
	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	test("a rules event refetches both an open rule drawer and an open entry drawer's embedded rule status", async () => {
		let status: RuleStatus = "draft";
		globalThis.fetch = ((input: unknown) => {
			const path = String(input);
			if (path === "/api/rules/r1") {
				return Promise.resolve(Response.json(ruleDetail(status)));
			}
			if (path === "/api/entries/e1") {
				return Promise.resolve(Response.json(entryDetailWithRule(status)));
			}
			return Promise.resolve(
				new Response(`unexpected ${path}`, { status: 404 }),
			);
		}) as typeof fetch;

		const client = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});

		function Drawers() {
			const rule = useRule("r1");
			const entry = useEntry("e1");
			return (
				<div>
					<span data-testid="rule-status">
						{rule.data?.status ?? "loading"}
					</span>
					<span data-testid="entry-rule-status">
						{entry.data?.rules[0]?.status ?? "loading"}
					</span>
				</div>
			);
		}

		render(
			<QueryClientProvider client={client}>
				<Drawers />
			</QueryClientProvider>,
		);

		await waitFor(() => {
			expect(screen.getByTestId("rule-status").textContent).toBe("draft");
			expect(screen.getByTestId("entry-rule-status").textContent).toBe("draft");
		});

		status = "verified";
		applyServerEvent(client, { type: "rules", repo_id: "r_1" }, () => {});

		await waitFor(() => {
			expect(screen.getByTestId("rule-status").textContent).toBe("verified");
			expect(screen.getByTestId("entry-rule-status").textContent).toBe(
				"verified",
			);
		});
	});
});
