import { describe, expect, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PromotionSummary } from "../../src/shared/api.ts";
import { PromotionsTable } from "../../web/src/components/PromotionsTable.tsx";
import type { PromotionCounts } from "../../web/src/lib/promotions.ts";

const counts: PromotionCounts = { open: 1, merged: 2, closed: 0 };

function promotion(
	overrides: Partial<PromotionSummary> = {},
): PromotionSummary {
	return {
		id: "pm_1",
		repo_id: "r_1",
		branch: "notam/rules-20260823-abc123",
		pr_number: 900,
		pr_url: "https://github.com/acme/mono/pull/900",
		state: "open",
		created_at: "2026-08-23T09:00:00.000Z",
		last_checked_at: null,
		rule_count: 2,
		...overrides,
	};
}

type Props = Parameters<typeof PromotionsTable>[0];

function draw(overrides: Partial<Props> = {}) {
	const calls = {
		state: [] as string[],
		q: [] as string[],
		refreshed: 0,
	};
	const props: Props = {
		promotions: [promotion()],
		counts,
		state: "",
		onStateChange: (next) => calls.state.push(next),
		query: "",
		onQueryChange: (next) => calls.q.push(next),
		onRefresh: () => {
			calls.refreshed++;
		},
		refreshing: false,
		loading: false,
		...overrides,
	};
	render(<PromotionsTable {...props} />);
	return calls;
}

describe("PromotionsTable", () => {
	test("links the pull request and shows the branch it was cut from", () => {
		draw();
		const link = screen.getByRole("link", { name: "#900" });
		expect(link.getAttribute("href")).toBe(
			"https://github.com/acme/mono/pull/900",
		);
		expect(link.getAttribute("target")).toBe("_blank");
		expect(screen.getByText("notam/rules-20260823-abc123")).toBeDefined();
	});

	/**
	 * The branch is written before the pull request exists, so the columns have
	 * to read without one: the branch is the only handle there is, and a link to
	 * nowhere is worse than plain text.
	 */
	test("falls back to the branch alone when there is no pull request yet", () => {
		draw({ promotions: [promotion({ pr_number: null, pr_url: null })] });
		expect(screen.queryByRole("link")).toBeNull();
		expect(screen.getByText("notam/rules-20260823-abc123")).toBeDefined();
	});

	test("shows the state, the rule count, and the dates as ISO days", () => {
		// Chip counts that cannot be mistaken for the rule count below them.
		draw({
			counts: { open: 1, merged: 0, closed: 0 },
			promotions: [promotion({ last_checked_at: "2026-08-24T11:30:00.000Z" })],
		});
		expect(screen.getByText("open")).toBeDefined();
		expect(screen.getByText("2")).toBeDefined();
		expect(screen.getByText("2026-08-23")).toBeDefined();
		expect(screen.getByText("2026-08-24")).toBeDefined();
	});

	test("says so when a promotion has never been checked", () => {
		draw();
		expect(screen.getByText("never")).toBeDefined();
	});

	test("offers a chip per state, carrying its count", async () => {
		const calls = draw();
		expect(screen.getByRole("button", { name: "Open 1" })).toBeDefined();
		expect(screen.getByRole("button", { name: "Merged 2" })).toBeDefined();
		expect(screen.getByRole("button", { name: "Closed 0" })).toBeDefined();
		await userEvent.click(screen.getByRole("button", { name: "Merged 2" }));
		expect(calls.state).toEqual(["merged"]);
	});

	test("the active chip clears itself, so a filter is never a trap", async () => {
		const calls = draw({ state: "open" });
		await userEvent.click(screen.getByRole("button", { name: "Open 1" }));
		expect(calls.state).toEqual([""]);
	});

	test("the filter box reports what was typed", async () => {
		const calls = draw();
		await userEvent.type(
			screen.getByRole("searchbox", {
				name: /filter promotions by branch or pull request number/i,
			}),
			"9",
		);
		expect(calls.q).toEqual(["9"]);
	});

	test("distinguishes an empty repository from an empty filter", () => {
		draw({ promotions: [] });
		expect(screen.getByText("No promotions yet.")).toBeDefined();
	});

	test("points at the rules tab when there is nothing to show yet", () => {
		draw({ promotions: [] });
		expect(screen.getByText(/Rules tab/)).toBeDefined();
	});

	test("says a filter is hiding the rest when one is applied", () => {
		draw({ promotions: [], query: "trunk" });
		expect(screen.getByText("No promotions match this filter.")).toBeDefined();
	});

	test("refresh keeps its name and goes down while it runs", () => {
		draw({ refreshing: true });
		const button = screen.getByRole("button", { name: /refresh status/i });
		expect(button.hasAttribute("disabled")).toBe(true);
		// The spin is decoration, so aria-busy is the only signal a screen
		// reader gets that the press landed.
		expect(button.getAttribute("aria-busy")).toBe("true");
	});

	test("refresh reports a click", async () => {
		const calls = draw();
		await userEvent.click(
			screen.getByRole("button", { name: /refresh status/i }),
		);
		expect(calls.refreshed).toBe(1);
	});

	test("a failed refresh shows the server's text beside the button", () => {
		draw({
			error: "GET /repos/acme/mono/pulls/900 -> 401: Bad credentials",
		});
		expect(
			screen.getByText(
				"GET /repos/acme/mono/pulls/900 -> 401: Bad credentials",
			),
		).toBeDefined();
	});

	test("shows a skeleton rather than an empty table while loading", () => {
		draw({ promotions: [], loading: true });
		expect(screen.queryByText("No promotions yet.")).toBeNull();
	});
});
