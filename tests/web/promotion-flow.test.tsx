import { afterEach, describe, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
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
describe("PromotionFlow", () => {
	test("shows a visible title while the plan is in flight", () => {
		// Never resolves: the assertion runs while the mutation is still pending.
		globalThis.fetch = ((_input: unknown) =>
			new Promise(() => {})) as typeof fetch;

		render(
			<QueryClientProvider client={client()}>
				<PromotionFlow ruleIds={["ru_1"]} onClose={() => {}} />
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
				<PromotionFlow ruleIds={["ru_1"]} onClose={() => {}} />
			</QueryClientProvider>,
		);

		await waitFor(() =>
			expect(screen.getByText("repository not found")).toBeDefined(),
		);
		expect(
			screen.getByRole("heading", { name: "Create rules pull request" }),
		).toBeDefined();
	});
});
