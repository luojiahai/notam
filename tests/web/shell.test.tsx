import { describe, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import type { PromotionSummary, RepoSummary } from "../../src/shared/api.ts";
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
