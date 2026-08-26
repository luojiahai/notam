import { describe, expect, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { type Tab, Tabs } from "../../web/src/components/Tabs.tsx";

type Id = "entries" | "rules" | "promotions";

const TABS: readonly Tab<Id>[] = [
	{ id: "entries", label: "Entries" },
	{ id: "rules", label: "Rules" },
	{ id: "promotions", label: "Promotions" },
];

function Harness() {
	const [active, setActive] = useState<Id>("entries");
	return (
		<>
			<button type="button">Before</button>
			<Tabs tabs={TABS} active={active} onChange={setActive} panelId="panel" />
			<div
				id="panel"
				role="tabpanel"
				aria-labelledby={`tab-${active}`}
				// biome-ignore lint/a11y/noNoninteractiveTabindex: mirrors App's own panel, which carries it so a tab whose panel is empty is still reachable — and the first case below asserts Tab leaves the run for exactly this element.
				tabIndex={0}
			>
				{active}
			</div>
		</>
	);
}

const selected = () => screen.getByRole("tab", { selected: true });

describe("Tabs", () => {
	test("the run is one tab stop, not one per tab", async () => {
		render(<Harness />);
		screen.getByRole("button", { name: "Before" }).focus();
		await userEvent.tab();
		expect(document.activeElement).toBe(selected());
		// Out of the run entirely rather than on to the next tab.
		await userEvent.tab();
		expect(document.activeElement?.getAttribute("role")).toBe("tabpanel");
	});

	test("the arrows move within the run and wrap at its ends", async () => {
		render(<Harness />);
		selected().focus();
		await userEvent.keyboard("{ArrowRight}");
		expect(selected().textContent).toBe("Rules");
		expect(document.activeElement).toBe(selected());
		await userEvent.keyboard("{ArrowRight}{ArrowRight}");
		expect(selected().textContent).toBe("Entries");
		await userEvent.keyboard("{ArrowLeft}");
		expect(selected().textContent).toBe("Promotions");
	});

	test("Home and End reach the ends of the run", async () => {
		render(<Harness />);
		selected().focus();
		await userEvent.keyboard("{End}");
		expect(selected().textContent).toBe("Promotions");
		await userEvent.keyboard("{Home}");
		expect(selected().textContent).toBe("Entries");
	});

	test("each tab names the panel it controls, and the panel names it back", async () => {
		render(<Harness />);
		await userEvent.click(screen.getByRole("tab", { name: "Rules" }));
		expect(selected().getAttribute("aria-controls")).toBe("panel");
		expect(screen.getByRole("tabpanel").getAttribute("aria-labelledby")).toBe(
			selected().id,
		);
	});
});
