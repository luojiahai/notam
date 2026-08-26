import { describe, expect, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { Dialog } from "../../web/src/components/Dialog.tsx";
import { Panel } from "../../web/src/components/Panel.tsx";

/**
 * The three promises `aria-modal="true"` makes, and the one that dismisses.
 *
 * These are asserted against real focus and real pointer sequences rather than
 * against markup, because every one of them is a behaviour that markup alone
 * looks correct without: a surface can carry `aria-modal` and still let Tab
 * walk into the table behind it.
 */

/** An opener outside the overlay, so focus has somewhere wrong to be. */
function Harness({ kind }: { kind: "panel" | "dialog" }) {
	const [open, setOpen] = useState(false);
	return (
		<>
			<button type="button" onClick={() => setOpen(true)}>
				Open
			</button>
			<button type="button">Behind</button>
			{open &&
				(kind === "panel" ? (
					<Panel title="Rule" onClose={() => setOpen(false)}>
						<button type="button">First</button>
						<button type="button">Last</button>
					</Panel>
				) : (
					<Dialog
						title="Confirm"
						confirmLabel="Do it"
						onConfirm={() => setOpen(false)}
						onCancel={() => setOpen(false)}
					>
						<button type="button">First</button>
					</Dialog>
				))}
		</>
	);
}

describe("overlay focus", () => {
	test("focus moves into the window rather than staying on the opener", async () => {
		render(<Harness kind="panel" />);
		await userEvent.click(screen.getByRole("button", { name: "Open" }));
		expect(document.activeElement).toBe(
			screen.getByRole("button", { name: "Close" }),
		);
	});

	test("Tab wraps at the end of the window instead of leaving it", async () => {
		render(<Harness kind="panel" />);
		await userEvent.click(screen.getByRole("button", { name: "Open" }));
		// Close, First, Last, then back to Close rather than out to "Behind".
		await userEvent.tab();
		await userEvent.tab();
		expect(document.activeElement).toBe(
			screen.getByRole("button", { name: "Last" }),
		);
		await userEvent.tab();
		expect(document.activeElement).toBe(
			screen.getByRole("button", { name: "Close" }),
		);
	});

	test("Shift+Tab wraps at the start of the window instead of leaving it", async () => {
		render(<Harness kind="panel" />);
		await userEvent.click(screen.getByRole("button", { name: "Open" }));
		await userEvent.tab({ shift: true });
		expect(document.activeElement).toBe(
			screen.getByRole("button", { name: "Last" }),
		);
	});

	test("closing returns focus to the control that opened it", async () => {
		render(<Harness kind="panel" />);
		const opener = screen.getByRole("button", { name: "Open" });
		await userEvent.click(opener);
		await userEvent.click(screen.getByRole("button", { name: "Close" }));
		expect(screen.queryByRole("dialog")).toBeNull();
		expect(document.activeElement).toBe(opener);
	});
});

describe("overlay dismissal", () => {
	test("a click on the backdrop closes the window", async () => {
		render(<Harness kind="dialog" />);
		await userEvent.click(screen.getByRole("button", { name: "Open" }));
		const backdrop = screen.getByRole("dialog").parentElement;
		expect(backdrop).not.toBeNull();
		if (backdrop) await userEvent.click(backdrop);
		expect(screen.queryByRole("dialog")).toBeNull();
	});

	test("a drag that starts inside and ends on the backdrop does not close it", async () => {
		render(<Harness kind="dialog" />);
		await userEvent.click(screen.getByRole("button", { name: "Open" }));
		const surface = screen.getByRole("dialog");
		const backdrop = surface.parentElement;
		expect(backdrop).not.toBeNull();
		if (!backdrop) return;
		// Selecting text in a dialog and releasing past its edge is one `click`
		// whose target is the backdrop. Treating that as a dismissal throws away
		// whatever the user was in the middle of.
		await userEvent.pointer([
			{ target: surface, keys: "[MouseLeft>]" },
			{ target: backdrop, keys: "[/MouseLeft]" },
		]);
		expect(screen.queryByRole("dialog")).not.toBeNull();
	});

	test("Escape closes the window", async () => {
		render(<Harness kind="dialog" />);
		await userEvent.click(screen.getByRole("button", { name: "Open" }));
		await userEvent.keyboard("{Escape}");
		expect(screen.queryByRole("dialog")).toBeNull();
	});
});
