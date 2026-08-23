import { describe, expect, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PromotionPlanView } from "../../src/shared/api.ts";
import { PromotionDialog } from "../../web/src/components/PromotionDialog.tsx";

const plan: PromotionPlanView = {
	repo_id: "r_1",
	repo_name: "acme/monolith",
	base_branch: "main",
	files: [
		{
			rule_id: "ru_1",
			kind: "do",
			directive: "Always add a regression test alongside a bug fix.",
			path: ".claude/rules/always-add-a-regression-test-2.md",
			content:
				"---\nid: ru_1\nnotam: true\n---\n\nAlways add a regression test.\n",
		},
		{
			rule_id: "ru_2",
			kind: "dont",
			directive: "Never round money with floating point.",
			path: ".claude/rules/never-round-money-with-floating-point.md",
			content: "---\nid: ru_2\nnotam: true\n---\n\nNever round money.\n",
		},
	],
	collisions: [
		{
			rule_id: "ru_1",
			directive: "Always add a regression test alongside a bug fix.",
			reason: "base-branch",
			existing: ".claude/rules/always-add-a-regression-test.md",
			path: ".claude/rules/always-add-a-regression-test-2.md",
		},
	],
};

type Props = Parameters<typeof PromotionDialog>[0];

function draw(overrides: Partial<Props> = {}) {
	const calls = { toggled: [] as string[], confirmed: 0, cancelled: 0 };
	const props: Props = {
		plan,
		included: ["ru_1", "ru_2"],
		onToggle: (id) => calls.toggled.push(id),
		onCancel: () => {
			calls.cancelled++;
		},
		onConfirm: () => {
			calls.confirmed++;
		},
		submitting: false,
		error: null,
		planning: false,
		...overrides,
	};
	render(<PromotionDialog {...props} />);
	return calls;
}

describe("PromotionDialog", () => {
	test("lists every file that would be committed", () => {
		draw();
		expect(
			screen.getByText(
				".claude/rules/never-round-money-with-floating-point.md",
			),
		).toBeDefined();
		expect(screen.getByText(/Never round money\./)).toBeDefined();
		// The repository and the base branch appear in both the summary line and
		// the collision sentence, so assert presence rather than uniqueness.
		expect(screen.getAllByText(/acme\/monolith/).length).toBeGreaterThan(0);
		expect(screen.getAllByText(/main/).length).toBeGreaterThan(0);
	});

	test("names the collision in the spec's own words", () => {
		draw();
		expect(
			screen.getByText(
				"always-add-a-regression-test.md already exists in acme/monolith; promoting adds a second file.",
			),
		).toBeDefined();
	});

	test("deselecting a colliding rule reports the toggle", async () => {
		const calls = draw();
		await userEvent.click(
			screen.getByRole("checkbox", {
				name: /Always add a regression test alongside a bug fix\./,
			}),
		);
		expect(calls.toggled).toEqual(["ru_1"]);
	});

	test("confirming reports it once", async () => {
		const calls = draw();
		await userEvent.click(
			screen.getByRole("button", { name: /create pull request/i }),
		);
		expect(calls.confirmed).toBe(1);
	});

	test("confirming is refused while nothing is included", () => {
		draw({ included: [] });
		expect(
			(
				screen.getByRole("button", {
					name: /create pull request/i,
				}) as HTMLButtonElement
			).disabled,
		).toBe(true);
	});

	test("confirming is refused while a request is in flight", () => {
		draw({ submitting: true });
		expect(
			(
				screen.getByRole("button", {
					name: /creating/i,
				}) as HTMLButtonElement
			).disabled,
		).toBe(true);
	});

	test("GitHub's error text is shown verbatim", () => {
		draw({
			error:
				"POST /repos/acme/mono/git/refs -> 403: Resource not accessible by integration",
		});
		expect(
			screen.getByText(
				"POST /repos/acme/mono/git/refs -> 403: Resource not accessible by integration",
			),
		).toBeDefined();
	});
});
