import { expect, test } from "@playwright/test";
import { type Harness, startHarness } from "./harness.ts";

let harness: Harness;

/**
 * The fake `claude` never returns here, so an analysis started in this file can
 * only end by being stopped. That is the state Stop exists for: a run that has
 * gone quiet, and a user who wants the machine back.
 */
test.beforeAll(async () => {
	harness = await startHarness({ hangingAnalyser: true });
});

test.afterAll(async () => {
	await harness?.stop();
});

test("analyse → stop → the entry returns to unanalysed and is analysable again", async ({
	page,
}) => {
	await page.goto(harness.baseUrl);
	await expect(page.getByRole("button", { name: /acme\/mono/ })).toBeVisible();

	await page.getByRole("checkbox", { name: "Select all entries" }).check();
	await page.getByRole("button", { name: /Analyse selected \(2\)/ }).click();

	// SSE drives the counter without a reload, so reaching this means both
	// analysers have really been spawned. Both at once: the seeded config
	// allows two.
	await expect(page.getByText(/2 running, 0 queued/)).toBeVisible({
		timeout: 30_000,
	});

	await page.getByRole("button", { name: /^Stop all$/ }).click();

	// The counter can only reach zero if both subprocesses were killed: the
	// fake analyser never returns on its own.
	await expect(page.getByText(/0 running, 0 queued/)).toBeVisible({
		timeout: 30_000,
	});
	await expect(page.getByText("Stopped 2")).toBeVisible();
	await expect(
		page.getByRole("button", { name: "Unanalysed 2" }),
	).toBeVisible();

	// A stop is not a failure: the chip that would have counted one reads zero.
	await expect(page.getByRole("button", { name: "Failed 0" })).toBeVisible();
	await page.getByRole("checkbox", { name: "Select all entries" }).check();
	await expect(
		page.getByRole("button", { name: /Analyse selected \(2\)/ }),
	).toBeEnabled();
});

test("a single row can be stopped on its own", async ({ page }) => {
	await page.goto(harness.baseUrl);
	await expect(page.getByRole("button", { name: /acme\/mono/ })).toBeVisible();

	const row = page.getByRole("row").nth(1);
	await row.getByRole("button", { name: /^Analyse #/ }).click();
	await expect(page.getByText(/1 running, 0 queued/)).toBeVisible({
		timeout: 30_000,
	});

	// Two controls, never one that changed verb: Analyse is still there, gone
	// quiet, while Stop is the one that came alive.
	await expect(row.getByRole("button", { name: /^Analyse #/ })).toBeDisabled();
	await row.getByRole("button", { name: /^Stop analysing #/ }).click();

	await expect(page.getByText(/0 running, 0 queued/)).toBeVisible({
		timeout: 30_000,
	});
	await expect(row.getByRole("button", { name: /^Analyse #/ })).toBeEnabled();
});
