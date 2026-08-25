import { afterEach, describe, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PromotionFlow } from "../../web/src/components/PromotionFlow.tsx";

const original = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = original;
});

/**
 * One client per test, created outside the render tree: see hooks.test.tsx
 * for why a client constructed inline in JSX would be replaced on every
 * re-render.
 */
function client(): QueryClient {
	return new QueryClient({
		defaultOptions: {
			queries: { retry: false },
			mutations: { retry: false },
		},
	});
}

/**
 * The loading and plan-error branches go through `Dialog` rather than
 * hand-rolling its shell, so they keep its visible `<h2>{title}</h2>` instead
 * of carrying the title in `aria-label` alone. These assert a real `heading`
 * role is on screen, not just an accessible name a screen reader announces.
 */
/** One rule, no collisions: the plan the dialog renders before a create. */
const plan = {
	repo_id: "r_1",
	repo_name: "acme/mono",
	base_branch: "main",
	files: [
		{
			rule_id: "ru_1",
			kind: "do",
			directive: "Always add a regression test.",
			path: ".claude/rules/always-add-a-regression-test.md",
			content: "---\nnotam: true\n---\n",
		},
	],
	collisions: [],
};

describe("PromotionFlow", () => {
	test("shows a visible title while the plan is in flight", () => {
		// Never resolves: the assertion runs while the mutation is still pending.
		globalThis.fetch = ((_input: unknown) =>
			new Promise(() => {})) as typeof fetch;

		render(
			<QueryClientProvider client={client()}>
				<PromotionFlow
					ruleIds={["ru_1"]}
					onClose={() => {}}
					onPromoted={() => {}}
				/>
			</QueryClientProvider>,
		);

		expect(
			screen.getByRole("heading", { name: "Create rules pull request" }),
		).toBeDefined();
		expect(screen.getByText("Checking the base branch…")).toBeDefined();
	});

	test("shows a visible title when planning fails", async () => {
		globalThis.fetch = ((_input: unknown) =>
			Promise.resolve(
				Response.json(
					{ error: { message: "repository not found" } },
					{ status: 404 },
				),
			)) as typeof fetch;

		render(
			<QueryClientProvider client={client()}>
				<PromotionFlow
					ruleIds={["ru_1"]}
					onClose={() => {}}
					onPromoted={() => {}}
				/>
			</QueryClientProvider>,
		);

		await waitFor(() =>
			expect(screen.getByText("repository not found")).toBeDefined(),
		);
		expect(
			screen.getByRole("heading", { name: "Create rules pull request" }),
		).toBeDefined();
	});

	/**
	 * The pull request lands in the promotions tab, which is not the tab the
	 * dialog was opened from, so the caller is told the moment it exists and
	 * can go there. Fired before the close, so the dialog's own teardown cannot
	 * swallow it.
	 */
	test("announces the pull request once the server has made it", async () => {
		globalThis.fetch = ((input: unknown, init?: RequestInit) => {
			const path = String(input);
			if (path === "/api/promotions/plan") {
				return Promise.resolve(Response.json(plan));
			}
			if (path === "/api/promotions" && init?.method === "POST") {
				return Promise.resolve(
					Response.json({
						id: "pm_1",
						repo_id: "r_1",
						branch: "notam/rules-20260823-abc123",
						pr_number: 900,
						pr_url: "https://github.com/acme/mono/pull/900",
						state: "open",
						created_at: "2026-08-23T09:00:00.000Z",
						last_checked_at: null,
						rule_count: 1,
					}),
				);
			}
			return Promise.resolve(
				new Response(`unexpected ${path}`, { status: 404 }),
			);
		}) as typeof fetch;

		const announced: number[] = [];
		const closed: number[] = [];
		render(
			<QueryClientProvider client={client()}>
				<PromotionFlow
					ruleIds={["ru_1"]}
					onClose={() => closed.push(closed.length)}
					onPromoted={() => announced.push(announced.length)}
				/>
			</QueryClientProvider>,
		);

		await userEvent.click(
			await screen.findByRole("button", { name: "Create pull request" }),
		);
		await waitFor(() => expect(announced).toHaveLength(1));
		expect(closed).toHaveLength(1);
	});

	test("says nothing about a pull request the server refused to make", async () => {
		globalThis.fetch = ((input: unknown, init?: RequestInit) => {
			const path = String(input);
			if (path === "/api/promotions/plan") {
				return Promise.resolve(Response.json(plan));
			}
			if (path === "/api/promotions" && init?.method === "POST") {
				return Promise.resolve(
					Response.json(
						{ error: { message: "401: Bad credentials" } },
						{ status: 401 },
					),
				);
			}
			return Promise.resolve(
				new Response(`unexpected ${path}`, { status: 404 }),
			);
		}) as typeof fetch;

		const announced: number[] = [];
		render(
			<QueryClientProvider client={client()}>
				<PromotionFlow
					ruleIds={["ru_1"]}
					onClose={() => {}}
					onPromoted={() => announced.push(1)}
				/>
			</QueryClientProvider>,
		);

		await userEvent.click(
			await screen.findByRole("button", { name: "Create pull request" }),
		);
		await waitFor(() =>
			expect(screen.getByText("401: Bad credentials")).toBeDefined(),
		);
		expect(announced).toHaveLength(0);
	});
});
