import { afterEach, describe, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import type {
	EntriesResponse,
	EntryDetail,
	EntrySummary,
	Meta,
	PromotionSummary,
	RepoSummary,
	RuleDetail,
	RuleStatus,
	ServerEvent,
} from "../../src/shared/api.ts";
import type { SyncProgress } from "../../web/src/App.tsx";
import { App, applyServerEvent, invalidationsFor } from "../../web/src/App.tsx";
import { useEntry, useRule } from "../../web/src/api/hooks.ts";
import { Shell } from "../../web/src/components/Shell.tsx";
import { Sidebar } from "../../web/src/components/Sidebar.tsx";

const repo: RepoSummary = {
	id: "r_1",
	name: "acme/mono",
	host_id: "github",
	host_label: "GitHub",
	url: "https://github.com/acme/mono",
	default_branch: "main",
	path_globs: ["services/payments/**"],
	window_days: 180,
	sync_watermark: null,
	sync: { state: "idle", started_at: null, last: null },
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

describe("Shell", () => {
	test("renders the expansion beside the wordmark, outside the heading", () => {
		wrap(
			<Shell version="1.0.0" warnings={[]} sidebar={null}>
				{null}
			</Shell>,
		);
		expect(
			screen.getByText("Notes On Team Agreements & Methods"),
		).toBeDefined();
		// The expansion is chrome, not the page's heading. Moving it inside the
		// `h1` would rewrite the accessible name of the only level-one heading
		// there is, and nothing else would notice.
		expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("NOTAM");
	});
});

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

	/**
	 * Two repositories sync at once by design, so one can be working while the
	 * user is looking at another. Without a mark on the row that sync is
	 * invisible until its counts move.
	 */
	test("marks a repository that is syncing, selected or not", () => {
		wrap(
			<Sidebar
				repos={[
					{
						...repo,
						id: "r_2",
						name: "acme/api",
						sync: {
							state: "running",
							started_at: "2026-08-23T09:00:00.000Z",
							last: null,
						},
					},
					repo,
				]}
				promotions={[]}
				selectedRepoId="r_1"
				onSelectRepo={() => {}}
				onRefreshPromotions={() => {}}
				refreshing={false}
			/>,
		);
		expect(
			screen.getByRole("button", { name: /acme\/api/ }).textContent,
		).toContain("syncing");
		expect(
			screen.getByRole("button", { name: /acme\/mono/ }).textContent,
		).not.toContain("syncing");
	});

	test("distinguishes a repository queued behind another from one running", () => {
		wrap(
			<Sidebar
				repos={[
					{ ...repo, sync: { state: "queued", started_at: null, last: null } },
				]}
				promotions={[]}
				selectedRepoId="r_1"
				onSelectRepo={() => {}}
				onRefreshPromotions={() => {}}
				refreshing={false}
			/>,
		);
		expect(screen.getByText("queued")).toBeDefined();
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

	test("a failed refresh shows the server's text beside the button", () => {
		wrap(
			<Sidebar
				repos={[repo]}
				promotions={[]}
				selectedRepoId="r_1"
				onSelectRepo={() => {}}
				onRefreshPromotions={() => {}}
				refreshing={false}
				refreshError="GET /repos/acme/mono/pulls/900 -> 401: Bad credentials"
			/>,
		);
		expect(
			screen.getByText(
				"GET /repos/acme/mono/pulls/900 -> 401: Bad credentials",
			),
		).toBeDefined();
	});

	/**
	 * The control is an icon on the Promotions heading now, not a labelled
	 * button under it. An icon with no accessible name is a button nobody using
	 * a screen reader can find, so the name is asserted alongside the shape.
	 */
	test("refresh is an icon that keeps its name and goes down while it runs", () => {
		wrap(
			<Sidebar
				repos={[repo]}
				promotions={[promotion]}
				selectedRepoId="r_1"
				onSelectRepo={() => {}}
				onRefreshPromotions={() => {}}
				refreshing={true}
			/>,
		);
		const button = screen.getByRole("button", { name: /refresh status/i });
		expect(button.textContent).toBe("");
		expect(button.hasAttribute("disabled")).toBe(true);
		// The name stays put while it runs — only the state changes. The spin is
		// decoration, so aria-busy is the only signal a screen reader gets.
		expect(button.getAttribute("aria-busy")).toBe("true");
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
			scanned: 3,
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

		// A sync that has only just started has ingested nothing, so asking for
		// entries would be a round trip for data that cannot have changed.
		expect(invalidationsFor({ ...syncEvent, phase: "started" })).toEqual([
			["repos"],
		]);

		// A throttled tick refreshes the rows and the counts, but not an open
		// drawer: the terminal event reconciles that once, rather than twice a
		// second for the length of the sync.
		expect(invalidationsFor({ ...syncEvent, phase: "progress" })).toEqual([
			["entries"],
			["repos"],
		]);

		expect(invalidationsFor({ ...syncEvent, phase: "cancelled" })).toEqual([
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

	test("a progress event records the running tally against its repository", () => {
		const client = new QueryClient();
		const seen: [string, SyncProgress | null][] = [];
		applyServerEvent(
			client,
			{
				type: "sync",
				repo_id: "r_1",
				phase: "progress",
				scanned: 142,
				created: 28,
				updated: 2,
				skipped: 112,
				error: null,
			},
			(repoId, progress) => seen.push([repoId, progress]),
		);
		expect(seen).toEqual([
			["r_1", { scanned: 142, created: 28, updated: 2, skipped: 112 }],
		]);
	});

	test("every other phase clears the tally, which has no totals worth showing", () => {
		const client = new QueryClient();
		const seen: (SyncProgress | null)[] = [];
		const base = {
			type: "sync",
			repo_id: "r_1",
			scanned: 9,
			created: 9,
			updated: 0,
			skipped: 0,
			error: null,
		} as const;
		for (const phase of ["started", "finished", "cancelled"] as const) {
			applyServerEvent(client, { ...base, phase }, (_repoId, progress) =>
				seen.push(progress),
			);
		}
		expect(seen).toEqual([null, null, null]);
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

const meta: Meta = {
	version: "test",
	config_path: "/home/u/.notam/config.yaml",
	db_path: "/home/u/.notam/notam.db",
	claude_available: true,
	warnings: [],
	analysis: { concurrency: 2, timeout_seconds: 30, model: null },
};

const refreshResult = {
	checked: 0,
	merged: 0,
	closed: 0,
	unchanged: 0,
	returned_to_draft: 0,
	errors: [],
};

function entriesFor(repoId: string, number: number): EntriesResponse {
	const summary: EntrySummary = {
		id: `e_${repoId}`,
		repo_id: repoId,
		number,
		title: `A pull request in ${repoId}`,
		author: "dana",
		url: `https://example.invalid/pull/${number}`,
		merged_at: "2026-08-20T10:00:00.000Z",
		updated_at: "2026-08-21T10:00:00.000Z",
		matched_prefix: null,
		changed_file_count: 1,
		comment_count: 0,
		paths_truncated: false,
		analysis_state: "unanalysed",
		analysed_at: null,
		last_error: null,
		rule_count: 0,
		draft_rule_count: 0,
	};
	return {
		entries: [summary],
		counts: {
			total: 1,
			unanalysed: 1,
			queued: 0,
			running: 0,
			analysed: 0,
			failed: 0,
		},
	};
}

/**
 * The repository switch half of the selection rule. `App` renders the tab in
 * the same position for every repository, so without a key React would keep
 * the previous repository's selection mounted — and `POST /entries/analyse`
 * does not scope by repository, so it would happily analyse those entries.
 */
describe("App", () => {
	const originalFetch = globalThis.fetch;
	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	/**
	 * Sync belongs to a repository, not to the app, so with no repository there
	 * is no control at all — not a disabled one, which is what a header-level
	 * Sync renders when nothing is selected.
	 */
	test("offers no sync control until a repository is selected", async () => {
		globalThis.fetch = ((input: unknown) => {
			const path = String(input);
			if (path === "/api/meta") return Promise.resolve(Response.json(meta));
			if (path === "/api/repos") return Promise.resolve(Response.json([]));
			if (path === "/api/promotions/refresh") {
				return Promise.resolve(Response.json(refreshResult));
			}
			return Promise.resolve(
				new Response(`unexpected ${path}`, { status: 404 }),
			);
		}) as typeof fetch;

		wrap(<App />);

		await screen.findByText(/no repository selected/i);
		expect(screen.queryByRole("button", { name: /sync/i })).toBeNull();
	});

	test("Sync posts for the repository the bar names", async () => {
		const posted: string[] = [];
		globalThis.fetch = ((input: unknown, init?: RequestInit) => {
			const path = String(input);
			if (path === "/api/meta") return Promise.resolve(Response.json(meta));
			if (path === "/api/repos") return Promise.resolve(Response.json([repo]));
			if (path.startsWith("/api/repos/r_1/entries")) {
				return Promise.resolve(Response.json(entriesFor("r_1", 11)));
			}
			if (path.endsWith("/promotions")) {
				return Promise.resolve(Response.json([]));
			}
			if (path === "/api/promotions/refresh") {
				return Promise.resolve(Response.json(refreshResult));
			}
			if (init?.method === "POST" && path.endsWith("/sync")) {
				posted.push(path);
				return Promise.resolve(Response.json({ job_id: "j_1" }));
			}
			return Promise.resolve(
				new Response(`unexpected ${path}`, { status: 404 }),
			);
		}) as typeof fetch;

		wrap(<App />);

		await screen.findByRole("button", { name: /^sync$/i });
		await userEvent.click(screen.getByRole("button", { name: /^sync$/i }));
		await waitFor(() => expect(posted).toEqual(["/api/repos/r_1/sync"]));
	});

	test("switching repository drops the selection made in the previous one", async () => {
		const second: RepoSummary = { ...repo, id: "r_2", name: "acme/api" };
		globalThis.fetch = ((input: unknown) => {
			const path = String(input);
			if (path === "/api/meta") return Promise.resolve(Response.json(meta));
			if (path === "/api/repos") {
				return Promise.resolve(Response.json([repo, second]));
			}
			if (path.startsWith("/api/repos/r_1/entries")) {
				return Promise.resolve(Response.json(entriesFor("r_1", 11)));
			}
			if (path.startsWith("/api/repos/r_2/entries")) {
				return Promise.resolve(Response.json(entriesFor("r_2", 22)));
			}
			if (path.endsWith("/promotions")) {
				return Promise.resolve(Response.json([]));
			}
			if (path === "/api/promotions/refresh") {
				return Promise.resolve(Response.json(refreshResult));
			}
			return Promise.resolve(
				new Response(`unexpected ${path}`, { status: 404 }),
			);
		}) as typeof fetch;

		wrap(<App />);

		await screen.findByRole("checkbox", { name: /select #11/i });
		await userEvent.click(
			screen.getByRole("checkbox", { name: /select all entries/i }),
		);
		expect(screen.getByText("1 selected")).toBeDefined();

		await userEvent.click(screen.getByRole("button", { name: /acme\/api/ }));

		await screen.findByRole("checkbox", { name: /select #22/i });
		expect(screen.getByText("0 selected")).toBeDefined();
	});
});
