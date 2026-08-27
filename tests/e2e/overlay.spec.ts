import { expect, type Page, test } from "@playwright/test";
import { type Harness, startHarness } from "./harness.ts";

let harness: Harness;

test.beforeAll(async () => {
	harness = await startHarness();
});

test.afterAll(async () => {
	await harness?.stop();
});

/**
 * The sizes an overlay has to survive, from a wide desktop down to a phone.
 * The small end is where this last broke: a window whose contents could not
 * shrink grew past the viewport, and the overflow it centred went off the
 * left edge — which a reader sees as a window that failed to centre rather
 * than as one that is too big.
 */
const SIZES = [
	{ width: 1440, height: 900 },
	{ width: 1024, height: 660 },
	{ width: 820, height: 560 },
	{ width: 600, height: 460 },
	{ width: 420, height: 720 },
];

/** Centred, and wholly on screen. Neither is worth much without the other. */
async function expectCentred(page: Page): Promise<void> {
	const box = await page.locator(".window").first().boundingBox();
	const viewport = page.viewportSize();
	expect(box).not.toBeNull();
	expect(viewport).not.toBeNull();
	if (!box || !viewport) return;
	const left = Math.round(box.x);
	const right = Math.round(viewport.width - box.x - box.width);
	const top = Math.round(box.y);
	const bottom = Math.round(viewport.height - box.y - box.height);
	// A subpixel layout can split an odd remainder unevenly; a whole pixel of
	// slack is the tolerance, and anything past it is a real bias.
	expect(Math.abs(left - right)).toBeLessThanOrEqual(1);
	expect(Math.abs(top - bottom)).toBeLessThanOrEqual(1);
	expect(left).toBeGreaterThanOrEqual(0);
	expect(top).toBeGreaterThanOrEqual(0);
}

/**
 * These three share one server, so by the third the entries may already carry
 * the rules the second one made — and re-running analysis over them raises the
 * discard-drafts confirmation instead, which is a different screen entirely.
 *
 * Whether rules exist is read off the rules table once it has stopped loading,
 * rather than off an entries chip: `getByRole` matches an accessible name by
 * substring, so a chip reading "Analysed 2" cannot be told from the
 * "Unanalysed 2" beside it.
 */
async function ensureRules(page: Page): Promise<void> {
	const rows = page.locator("td.cell-title button");
	await page.getByRole("tab", { name: "Rules" }).click();
	await expect(page.locator(".table-wrap")).toHaveAttribute(
		"aria-busy",
		"false",
	);
	if ((await rows.count()) > 0) return;

	await page.getByRole("tab", { name: "Entries" }).click();
	await page.getByRole("checkbox", { name: "Select all entries" }).check();
	await page.getByRole("button", { name: /Analyse selected \(2\)/ }).click();
	await expect(
		page.getByRole("button", { name: "Analysed 2", exact: true }),
	).toBeVisible({ timeout: 30_000 });
	await page.getByRole("tab", { name: "Rules" }).click();
	await expect(rows.first()).toBeVisible();
}

test("settings stays centred and wholly on screen at every width", async ({
	page,
}) => {
	await page.setViewportSize(SIZES[0] ?? { width: 1440, height: 900 });
	await page.goto(harness.baseUrl);
	await expect(page.getByRole("button", { name: /acme\/mono/ })).toBeVisible();
	await page.getByRole("button", { name: "Settings" }).click();
	await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
	for (const size of SIZES) {
		await page.setViewportSize(size);
		await expectCentred(page);
	}
});

test("the promotion pre-flight stays centred and wholly on screen", async ({
	page,
}) => {
	await page.setViewportSize(SIZES[0] ?? { width: 1440, height: 900 });
	await page.goto(harness.baseUrl);
	await expect(page.getByRole("button", { name: /acme\/mono/ })).toBeVisible();
	await ensureRules(page);
	await page.getByRole("checkbox", { name: "Select all rules" }).check();
	await page.getByRole("button", { name: /Create rules PR/ }).click();
	await expect(
		page.getByRole("dialog", { name: "Create rules pull request" }),
	).toBeVisible();
	// The plan renders file previews, which is the content most able to force
	// a window wider than the space it has.
	await expect(page.locator(".plan-file").first()).toBeVisible();
	for (const size of SIZES) {
		await page.setViewportSize(size);
		await expectCentred(page);
	}
});

test("a click beside any window dismisses it", async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	await page.goto(harness.baseUrl);
	await expect(page.getByRole("button", { name: /acme\/mono/ })).toBeVisible();
	await ensureRules(page);

	// Settings: an editor, and it closes like the rest — nothing reaches the
	// config file until Save.
	await page.getByRole("button", { name: "Settings" }).click();
	await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
	await page.mouse.click(30, 450);
	await expect(page.getByRole("dialog", { name: "Settings" })).toBeHidden();

	// A record opened for reading.
	await page.locator("td.cell-title button").first().click();
	await expect(page.getByRole("dialog")).toBeVisible();
	await page.mouse.click(30, 450);
	await expect(page.getByRole("dialog")).toBeHidden();

	// A decision to take.
	await page.getByRole("checkbox", { name: "Select all rules" }).check();
	await page.getByRole("button", { name: /Create rules PR/ }).click();
	await expect(
		page.getByRole("dialog", { name: "Create rules pull request" }),
	).toBeVisible();
	await page.mouse.click(30, 450);
	await expect(
		page.getByRole("dialog", { name: "Create rules pull request" }),
	).toBeHidden();
});
