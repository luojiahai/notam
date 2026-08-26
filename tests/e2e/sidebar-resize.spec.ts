import type { Locator, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { type Harness, startHarness } from "./harness.ts";

let harness: Harness;

test.beforeAll(async () => {
	harness = await startHarness();
});

test.afterAll(async () => {
	await harness?.stop();
});

/*
 * Fixed so the arithmetic below is the stylesheet's, not the config's. At this
 * width the ceiling is the 30rem term rather than the 40vw one; the narrowing
 * test further down is where the other term takes over.
 */
test.use({ viewport: { width: 1280, height: 720 } });

const DEFAULT = 240;
const MIN = 176;
const MAX = 480;

/**
 * Everything here is a real box measured in a real browser, because that is the
 * only thing worth paying a browser for. The handle's keyboard and ARIA
 * contract needs no layout and is asserted under tests/web instead, which is
 * far faster.
 */
test("drag → clamp → reload: the sidebar keeps the width it was given", async ({
	page,
}) => {
	const { handle, width } = await open(page);
	await expect.poll(width).toBe(DEFAULT);

	// Dragging moves the edge by exactly the distance the pointer travelled.
	await drag(page, handle, 100);
	await expect.poll(width).toBe(DEFAULT + 100);

	// Past either bound the edge stops rather than following the pointer.
	await drag(page, handle, 600);
	await expect.poll(width).toBe(MAX);
	await drag(page, handle, -600);
	await expect.poll(width).toBe(MIN);

	// And the width survives a reload, applied before first paint rather than
	// snapping into place once React has mounted.
	await drag(page, handle, 124);
	await expect.poll(width).toBe(300);
	await reopen(page);
	await expect.poll(width).toBe(300);

	// Double-click restores the default, and forgets rather than pins it.
	await handle.dblclick();
	await expect.poll(width).toBe(DEFAULT);
	await reopen(page);
	await expect.poll(width).toBe(DEFAULT);
});

test("escape abandons a drag in progress", async ({ page }) => {
	const { handle, width } = await open(page);

	const at = await grab(page, handle);
	await page.mouse.move(at.x + 120, at.y, { steps: 10 });
	await expect.poll(width).toBe(DEFAULT + 120);

	await page.keyboard.press("Escape");
	await page.mouse.up();
	await expect.poll(width).toBe(DEFAULT);

	// Nothing was committed, so there is nothing to come back after a reload.
	await reopen(page);
	await expect.poll(width).toBe(DEFAULT);
});

test("an abandoned drag restores the preference, not the width on screen", async ({
	page,
}) => {
	const { handle, width } = await open(page);
	await drag(page, handle, 220);
	await expect.poll(width).toBe(460);

	// Narrow enough that what is on screen is a clamped 360, not the chosen 460.
	await page.setViewportSize({ width: 900, height: 720 });
	await expect.poll(width).toBe(360);

	const at = await grab(page, handle);
	await page.mouse.move(at.x - 80, at.y, { steps: 10 });
	await page.keyboard.press("Escape");
	await page.mouse.up();
	await expect.poll(width).toBe(360);

	/*
	 * The abandoned drag has to put back the width that was stored, not the one
	 * the narrow window was showing. Restoring what was on screen would quietly
	 * promote a temporary clamp into the standing preference, and 460 would
	 * never come back.
	 */
	await page.setViewportSize({ width: 1280, height: 720 });
	await expect.poll(width).toBe(460);
});

test("a narrowed window borrows the width back rather than taking it", async ({
	page,
}) => {
	const { handle, width } = await open(page);

	await drag(page, handle, 220);
	await expect.poll(width).toBe(460);

	// At 900px the 40vw term becomes the binding ceiling, below the stored 460.
	await page.setViewportSize({ width: 900, height: 720 });
	await expect.poll(width).toBe(360);
	/*
	 * And the announced ceiling moves with it. This is the assertion that the
	 * tokens are registered as lengths: an unregistered custom property would
	 * hand back the literal `min(30rem, 40vw)` here, the handle would fall back
	 * to its built-in 480, and Home/End would overshoot what CSS allows.
	 */
	await expect(handle).toHaveAttribute("aria-valuemax", "360");

	/*
	 * The point of the whole arrangement: narrowing the window is a transient
	 * fact about the window, not a change of mind about the sidebar, so the
	 * stored preference is untouched and widening gives it straight back.
	 */
	await page.setViewportSize({ width: 1280, height: 720 });
	await expect.poll(width).toBe(460);
});

test("the handle is reachable and operable from the keyboard", async ({
	page,
}) => {
	const { handle, width } = await open(page);

	await handle.focus();
	await expect(handle).toBeFocused();

	await page.keyboard.press("ArrowRight");
	await expect.poll(width).toBe(DEFAULT + 16);
	await page.keyboard.press("Shift+ArrowRight");
	await expect.poll(width).toBe(DEFAULT + 80);
	await page.keyboard.press("End");
	await expect.poll(width).toBe(MAX);
	await page.keyboard.press("Home");
	await expect.poll(width).toBe(MIN);
	await expect(handle).toHaveAttribute("aria-valuenow", String(MIN));
});

/** Loads the app, waits for the seeded repository, and hands back the pieces. */
async function open(page: Page) {
	await page.goto(harness.baseUrl);
	await ready(page);
	const sidebar = page.getByRole("navigation", { name: "Repositories" });
	return {
		handle: page.getByRole("separator", { name: "Resize sidebar" }),
		width: async () => Math.round((await sidebar.boundingBox())?.width ?? 0),
	};
}

async function reopen(page: Page): Promise<void> {
	await page.reload();
	await ready(page);
}

async function ready(page: Page): Promise<void> {
	await expect(page.getByRole("button", { name: /acme\/mono/ })).toBeVisible();
}

/** Presses the pointer on the handle and returns where it is now holding. */
async function grab(
	page: Page,
	handle: Locator,
): Promise<{ x: number; y: number }> {
	const box = await handle.boundingBox();
	if (!box) throw new Error("the resize handle has no box");
	const at = { x: box.x + box.width / 2, y: box.y + 100 };
	await page.mouse.move(at.x, at.y);
	await page.mouse.down();
	return at;
}

/** Grabs the handle and moves it `by` pixels horizontally, then lets go. */
async function drag(page: Page, handle: Locator, by: number): Promise<void> {
	const at = await grab(page, handle);
	await page.mouse.move(at.x + by, at.y, { steps: 10 });
	await page.mouse.up();
}
