import { expect, test } from "@playwright/test";
import { type Harness, startHarness } from "./harness.ts";

let harness: Harness;

test.beforeAll(async () => {
	harness = await startHarness({ bare: true });
});

test.afterAll(async () => {
	await harness?.stop();
});

/**
 * The whole first run, with nothing set up beforehand: the server writes its
 * own config, the browser opens on an empty state, and a repository is
 * configured without ever leaving the page.
 */
test("a first run configures a repository entirely from the browser", async ({
	page,
}) => {
	await page.goto(harness.baseUrl);

	await expect(page.getByText("No repositories yet")).toBeVisible();
	await page.getByRole("button", { name: "Configure a repository" }).click();

	// The default host is github.com. Point it at the stub, and at the variable
	// this harness actually exports.
	await page.getByLabel("API base").fill(harness.stub.url);
	await page.getByLabel("GraphQL endpoint").fill(`${harness.stub.url}/graphql`);
	await page.getByLabel("Token variable").fill("NOTAM_E2E_TOKEN");

	await page.getByRole("button", { name: "Add a repository" }).click();
	await page.getByLabel("Name", { exact: true }).fill("acme/mono");

	await page.getByRole("button", { name: "Save" }).click();

	// The sidebar is the proof: applyConfig ran in the same write, so the
	// repository is usable without a restart.
	const sidebar = page.getByRole("navigation", { name: "Repositories" });
	await expect(
		sidebar.getByRole("button", { name: /acme\/mono/ }),
	).toBeVisible();

	// The token belongs to the host, and the host is a pane of its own: proving
	// the variable reached the server means going back to it.
	await page.getByRole("button", { name: "github", exact: true }).click();
	await expect(page.getByText("NOTAM_E2E_TOKEN is set.")).toBeVisible();
});

test("removing it archives rather than deletes, and adding it back restores it", async ({
	page,
}) => {
	await page.goto(harness.baseUrl);
	// Scoped to the sidebar: the archive section names the same repository on
	// its own Restore and Delete buttons.
	const sidebar = page.getByRole("navigation", { name: "Repositories" });
	// The header control carries no label, so its accessible name is the only
	// handle on it — which is the point of asserting through it here.
	await page.getByRole("button", { name: "Settings" }).click();

	page.once("dialog", (dialog) => dialog.accept());
	await page.getByRole("button", { name: "Remove acme/mono" }).click();
	await page.getByRole("button", { name: "Save" }).click();

	await expect(page.getByText("Archived")).toBeVisible();
	await expect(sidebar.getByRole("button", { name: /acme\/mono/ })).toHaveCount(
		0,
	);

	// One entity is on screen at a time, so reaching an archived repository's
	// actions means selecting it first. Exact, because every one of those
	// actions names the repository too.
	await page.getByRole("button", { name: "acme/mono", exact: true }).click();
	await page.getByRole("button", { name: "Restore acme/mono" }).click();
	await page.getByRole("button", { name: "Save" }).click();

	await expect(
		sidebar.getByRole("button", { name: /acme\/mono/ }),
	).toBeVisible();
	await expect(page.getByText("Archived")).toHaveCount(0);
});
