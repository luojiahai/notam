import { expect, test } from "@playwright/test";
import { type Harness, startHarness } from "./harness.ts";

let harness: Harness;
let baseUrl: string;
let stub: Harness["stub"];

test.beforeAll(async () => {
	harness = await startHarness();
	baseUrl = harness.baseUrl;
	stub = harness.stub;
});

test.afterAll(async () => {
	// Guarded: a beforeAll that died before assigning `harness` would otherwise
	// throw here and bury the real failure.
	await harness?.stop();
});

test("unanalysed → analyse → review rules → create promotion PR", async ({
	page,
}) => {
	await page.goto(baseUrl);

	// The sidebar found the configured repository.
	await expect(page.getByRole("button", { name: /acme\/mono/ })).toBeVisible();

	// Filter to unanalysed.
	await page.getByRole("button", { name: "Unanalysed 2" }).click();
	await expect(page.getByRole("row")).toHaveCount(3); // header + 2

	// Multi-select and analyse.
	await page.getByRole("checkbox", { name: "Select all entries" }).check();
	await page.getByRole("button", { name: /Analyse selected \(2\)/ }).click();

	// SSE drives the table to Analysed with no reload.
	await expect(page.getByRole("button", { name: "Analysed 2" })).toBeVisible({
		timeout: 30_000,
	});

	// Review the rules.
	await page.getByRole("tab", { name: "Rules" }).click();
	await expect(
		page.getByText(/Always add a regression test number/),
	).toHaveCount(2);

	// The drawer shows the file that would be committed.
	await page
		.getByText(/Always add a regression test number/)
		.first()
		.click();
	await expect(page.getByText("notam: true")).toBeVisible();
	await page.getByRole("button", { name: "Close" }).click();

	// Select both and open the promotion dialog.
	await page.getByRole("checkbox", { name: "Select all rules" }).check();
	await page.getByRole("button", { name: /Create rules PR \(2\)/ }).click();

	const dialog = page.getByRole("dialog", {
		name: "Create rules pull request",
	});
	await expect(dialog).toBeVisible();
	await expect(dialog.getByText(/\.claude\/rules\//).first()).toBeVisible();

	await dialog.getByRole("button", { name: "Create pull request" }).click();

	// The rules moved to proposed and the stub received one pull request with
	// two files.
	await expect(page.getByRole("button", { name: "Proposed 2" })).toBeVisible();
	await expect(page.getByRole("link", { name: "#900" })).toBeVisible();
	expect(stub.pulls).toHaveLength(1);
	expect(stub.blobs).toHaveLength(2);
	expect(stub.pulls[0]?.base).toBe("main");
});
