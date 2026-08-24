import { expect, test } from "@playwright/test";
import { type Harness, startHarness } from "./harness.ts";

let harness: Harness;

test.beforeAll(async () => {
	harness = await startHarness();
});

test.afterAll(async () => {
	await harness?.stop();
});

/**
 * The stub's GraphQL listing never answers, so the sync started here can only
 * end by being stopped. That is the state Stop exists for: a request that is
 * going to sit there, whether because GitHub is slow or because the client is
 * waiting out a rate-limit window.
 */
test("sync → stop → the repository says so and is syncable again", async ({
	page,
}) => {
	await page.goto(harness.baseUrl);
	await expect(page.getByRole("button", { name: /acme\/mono/ })).toBeVisible();

	const sync = page.getByRole("button", { name: /^Sync$/ });
	await expect(sync).toBeEnabled();
	await sync.click();

	// The server has the job and the browser has been told, without a reload.
	await harness.stub.listingRequested;
	const syncing = page.getByRole("button", { name: /Syncing/ });
	await expect(syncing).toBeVisible();
	await expect(syncing).toBeDisabled();

	// Stop is its own control, not Sync having changed verb underneath.
	const stop = page.getByRole("button", { name: /^Stop$/ });
	await expect(stop).toBeVisible();
	await stop.click();

	// A stop is reported as a stop, never as a failure.
	await expect(page.getByText(/last sync stopped/i)).toBeVisible();
	await expect(page.getByText(/last sync failed/i)).toHaveCount(0);

	// And the repository is immediately syncable again: cancelling frees the
	// target rather than leaving it wedged behind a job that will never run.
	await expect(page.getByRole("button", { name: /^Sync$/ })).toBeEnabled();
});
