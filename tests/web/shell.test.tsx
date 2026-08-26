import { afterEach, describe, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
import {
	SIDEBAR_WIDTH_FALLBACK_MAX,
	SIDEBAR_WIDTH_FALLBACK_MIN,
	SIDEBAR_WIDTH_STORAGE_KEY,
} from "../../web/src/lib/sidebar-width.ts";

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

	test("links to NOTAM's own repository", () => {
		wrap(
			<Shell version="1.0.0" warnings={[]} sidebar={null}>
				{null}
			</Shell>,
		);
		const link = screen.getByRole("link", { name: "NOTAM on GitHub" });
		expect(link.getAttribute("href")).toBe(
			"https://github.com/luojiahai/notam",
		);
		expect(link.getAttribute("target")).toBe("_blank");
	});
});

describe("Sidebar", () => {
	test("lists repositories with their entry counts", () => {
		wrap(
			<Sidebar repos={[repo]} selectedRepoId="r_1" onSelectRepo={() => {}} />,
		);
		expect(screen.getByText("acme/mono")).toBeDefined();
		expect(screen.getByText(/12 entries/)).toBeDefined();
		expect(screen.getByText(/5 drafts/)).toBeDefined();
		expect(screen.getByText(/1 open promotion/)).toBeDefined();
	});

	/**
	 * Each count on the row names a tab, and a repository nobody has promoted
	 * from would otherwise carry a nought down the whole column.
	 */
	test("leaves the promotion count off a repository with none open", () => {
		wrap(
			<Sidebar
				repos={[{ ...repo, open_promotions: 0 }]}
				selectedRepoId="r_1"
				onSelectRepo={() => {}}
			/>,
		);
		expect(screen.queryByText(/open promotion/)).toBeNull();
	});

	test("marks the selected repository and reports a click", async () => {
		const picked: string[] = [];
		wrap(
			<Sidebar
				repos={[repo, { ...repo, id: "r_2", name: "acme/api" }]}
				selectedRepoId="r_1"
				onSelectRepo={(id) => picked.push(id)}
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
				selectedRepoId="r_1"
				onSelectRepo={() => {}}
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
				selectedRepoId="r_1"
				onSelectRepo={() => {}}
			/>,
		);
		expect(screen.getByText("queued")).toBeDefined();
	});
});

/*
 * happy-dom loads no stylesheet and lays nothing out, so the handle's own
 * bounds tokens never resolve and every width below is measured against the
 * built-in fallbacks. What is asserted here is therefore the contract a screen
 * reader and a keyboard see, which needs no layout at all. Where the box
 * actually ends up is a question only a real browser can answer, and it is
 * asked of one, under tests/e2e.
 */
describe("SidebarResizer", () => {
	afterEach(() => {
		localStorage.clear();
		document.documentElement.style.removeProperty("--sidebar-w");
	});

	function renderShell() {
		wrap(
			<Shell
				version="1.0.0"
				warnings={[]}
				sidebar={
					<Sidebar
						repos={[repo]}
						selectedRepoId="r_1"
						onSelectRepo={() => {}}
					/>
				}
			>
				{null}
			</Shell>,
		);
		return screen.getByRole("separator", { name: "Resize sidebar" });
	}

	test("is focusable and announces its range with a unit", () => {
		const handle = renderShell();
		expect(handle.getAttribute("tabindex")).toBe("0");
		expect(handle.getAttribute("aria-orientation")).toBe("vertical");
		expect(handle.getAttribute("aria-valuemin")).toBe(
			String(SIDEBAR_WIDTH_FALLBACK_MIN),
		);
		expect(handle.getAttribute("aria-valuemax")).toBe(
			String(SIDEBAR_WIDTH_FALLBACK_MAX),
		);
		expect(handle.getAttribute("aria-valuetext")).toBe(
			`${SIDEBAR_WIDTH_FALLBACK_MIN} pixels`,
		);
	});

	test("sits immediately after the sidebar, which is what it resizes", () => {
		const handle = renderShell();
		expect(handle.previousElementSibling?.tagName).toBe("NAV");
		expect(handle.previousElementSibling?.getAttribute("aria-label")).toBe(
			"Repositories",
		);
	});

	test("arrow keys nudge, and Shift jumps", () => {
		const handle = renderShell();
		fireEvent.keyDown(handle, { key: "ArrowRight" });
		expect(handle.getAttribute("aria-valuenow")).toBe(
			String(SIDEBAR_WIDTH_FALLBACK_MIN + 16),
		);
		fireEvent.keyDown(handle, { key: "ArrowRight", shiftKey: true });
		expect(handle.getAttribute("aria-valuenow")).toBe(
			String(SIDEBAR_WIDTH_FALLBACK_MIN + 80),
		);
		fireEvent.keyDown(handle, { key: "ArrowLeft" });
		expect(handle.getAttribute("aria-valuenow")).toBe(
			String(SIDEBAR_WIDTH_FALLBACK_MIN + 64),
		);
	});

	test("End and Home go to the bounds, and neither can be passed", () => {
		const handle = renderShell();
		fireEvent.keyDown(handle, { key: "End" });
		expect(handle.getAttribute("aria-valuenow")).toBe(
			String(SIDEBAR_WIDTH_FALLBACK_MAX),
		);
		fireEvent.keyDown(handle, { key: "ArrowRight" });
		expect(handle.getAttribute("aria-valuenow")).toBe(
			String(SIDEBAR_WIDTH_FALLBACK_MAX),
		);
		fireEvent.keyDown(handle, { key: "Home" });
		expect(handle.getAttribute("aria-valuenow")).toBe(
			String(SIDEBAR_WIDTH_FALLBACK_MIN),
		);
		fireEvent.keyDown(handle, { key: "ArrowLeft" });
		expect(handle.getAttribute("aria-valuenow")).toBe(
			String(SIDEBAR_WIDTH_FALLBACK_MIN),
		);
	});

	test("ignores keys that are not its own", () => {
		const handle = renderShell();
		fireEvent.keyDown(handle, { key: "ArrowUp" });
		fireEvent.keyDown(handle, { key: "a" });
		expect(handle.getAttribute("aria-valuenow")).toBe(
			String(SIDEBAR_WIDTH_FALLBACK_MIN),
		);
	});

	test("applies the width immediately but persists once, on release", () => {
		const handle = renderShell();
		const width = `${SIDEBAR_WIDTH_FALLBACK_MIN + 16}`;

		fireEvent.keyDown(handle, { key: "ArrowRight" });
		// The layout has already moved: a held key must not lag behind the finger.
		expect(document.documentElement.style.getPropertyValue("--sidebar-w")).toBe(
			`${width}px`,
		);
		// But nothing is stored yet, so key repeat costs no writes.
		expect(localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY)).toBeNull();

		fireEvent.keyUp(handle, { key: "ArrowRight" });
		expect(localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY)).toBe(width);
	});

	test("a release that follows no change writes nothing", () => {
		const handle = renderShell();
		fireEvent.keyUp(handle, { key: "Shift" });
		expect(localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY)).toBeNull();
	});

	test("double-click clears the preference rather than storing the default", () => {
		const handle = renderShell();
		fireEvent.keyDown(handle, { key: "ArrowRight" });
		fireEvent.keyUp(handle, { key: "ArrowRight" });
		expect(localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY)).not.toBeNull();

		fireEvent.dblClick(handle);
		expect(localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY)).toBeNull();
		// The override is gone too, so the stylesheet's own default applies.
		expect(document.documentElement.style.getPropertyValue("--sidebar-w")).toBe(
			"",
		);
	});

	test("adopts a width stored before it mounted", () => {
		localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, "300");
		const handle = renderShell();
		expect(document.documentElement.style.getPropertyValue("--sidebar-w")).toBe(
			"300px",
		);
		expect(handle.getAttribute("aria-valuenow")).toBe("300");
	});

	test("clamps a stored width that the current bounds no longer allow", () => {
		localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, "9000");
		const handle = renderShell();
		expect(handle.getAttribute("aria-valuenow")).toBe(
			String(SIDEBAR_WIDTH_FALLBACK_MAX),
		);
		// The stored preference is left alone: it is what the reader asked for,
		// and a window they widen again should give it back to them.
		expect(localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY)).toBe("9000");
	});
});

function ruleDetail(status: RuleStatus): RuleDetail {
	return {
		id: "r1",
		repo_id: "r_1",
		entry_id: "e1",
		type: "testing",
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

	test("offers a tab per list, entries first", async () => {
		globalThis.fetch = ((input: unknown) => {
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
			return Promise.resolve(
				new Response(`unexpected ${path}`, { status: 404 }),
			);
		}) as typeof fetch;

		wrap(<App />);

		const tabs = await screen.findAllByRole("tab");
		expect(tabs.map((tab) => tab.textContent)).toEqual([
			"Entries",
			"Rules",
			"Promotions",
		]);
		expect(tabs[0]?.getAttribute("aria-selected")).toBe("true");
	});

	test("the promotions tab lists this repository's promotions", async () => {
		globalThis.fetch = ((input: unknown) => {
			const path = String(input);
			if (path === "/api/meta") return Promise.resolve(Response.json(meta));
			if (path === "/api/repos") return Promise.resolve(Response.json([repo]));
			if (path.startsWith("/api/repos/r_1/entries")) {
				return Promise.resolve(Response.json(entriesFor("r_1", 11)));
			}
			if (path === "/api/repos/r_1/promotions") {
				return Promise.resolve(Response.json([promotion]));
			}
			if (path === "/api/promotions/refresh") {
				return Promise.resolve(Response.json(refreshResult));
			}
			return Promise.resolve(
				new Response(`unexpected ${path}`, { status: 404 }),
			);
		}) as typeof fetch;

		wrap(<App />);

		await userEvent.click(
			await screen.findByRole("tab", { name: "Promotions" }),
		);
		const link = await screen.findByRole("link", { name: "#900" });
		expect(link.getAttribute("href")).toBe(
			"https://github.com/acme/mono/pull/900",
		);
		expect(screen.getByText("notam/rules-20260823-abc123")).toBeDefined();
	});

	/**
	 * The pull request only ever shows on the promotions tab, so the create has
	 * to land the user there — the wiring runs from the dialog, through the
	 * rules tab, to the tab state held here.
	 */
	test("creating a rules pull request lands on the tab that holds it", async () => {
		globalThis.fetch = ((input: unknown, init?: RequestInit) => {
			const path = String(input);
			if (path === "/api/meta") return Promise.resolve(Response.json(meta));
			if (path === "/api/repos") return Promise.resolve(Response.json([repo]));
			if (path.startsWith("/api/repos/r_1/entries")) {
				return Promise.resolve(Response.json(entriesFor("r_1", 11)));
			}
			if (path.startsWith("/api/repos/r_1/rules")) {
				return Promise.resolve(
					Response.json({
						rules: [ruleDetail("draft")],
						counts: {
							total: 1,
							draft: 1,
							proposed: 0,
							verified: 0,
							abandoned: 0,
						},
					}),
				);
			}
			if (path === "/api/repos/r_1/promotions") {
				return Promise.resolve(Response.json([promotion]));
			}
			if (path === "/api/promotions/plan") {
				return Promise.resolve(
					Response.json({
						repo_id: "r_1",
						repo_name: "acme/mono",
						base_branch: "main",
						files: [
							{
								rule_id: "r1",
								type: "testing",
								directive: "Name the boundary",
								path: "docs/rules/name-the-boundary.md",
								content: "# Name the boundary\n",
							},
						],
						collisions: [],
					}),
				);
			}
			if (path === "/api/promotions" && init?.method === "POST") {
				return Promise.resolve(Response.json(promotion));
			}
			if (path === "/api/promotions/refresh") {
				return Promise.resolve(Response.json(refreshResult));
			}
			return Promise.resolve(
				new Response(`unexpected ${path}`, { status: 404 }),
			);
		}) as typeof fetch;

		wrap(<App />);

		await userEvent.click(await screen.findByRole("tab", { name: "Rules" }));
		await userEvent.click(
			await screen.findByRole("checkbox", { name: /select all rules/i }),
		);
		await userEvent.click(
			screen.getByRole("button", { name: /Create rules PR \(1\)/ }),
		);
		await userEvent.click(
			await screen.findByRole("button", { name: "Create pull request" }),
		);

		await waitFor(() =>
			expect(
				screen
					.getByRole("tab", { name: "Promotions" })
					.getAttribute("aria-selected"),
			).toBe("true"),
		);
	});
});
