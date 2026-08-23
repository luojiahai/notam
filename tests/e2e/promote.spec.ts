import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { type GitHubStub, startGitHubStub } from "./github-stub.ts";

const root = resolve(import.meta.dirname, "..", "..");

let stub: GitHubStub;
let child: ChildProcess;
let home: string;
let baseUrl: string;

async function waitForServer(url: string): Promise<void> {
	for (let attempt = 0; attempt < 100; attempt++) {
		try {
			const response = await fetch(`${url}/api/meta`);
			if (response.ok) return;
		} catch {
			// not up yet
		}
		await new Promise((done) => setTimeout(done, 100));
	}
	throw new Error(`${url} never came up`);
}

test.beforeAll(async () => {
	stub = await startGitHubStub();
	home = mkdtempSync(join(tmpdir(), "notam-e2e-"));

	execFileSync("bun", ["run", "tests/e2e/seed.ts", home, stub.url], {
		cwd: root,
		stdio: "inherit",
	});

	// A bin directory holding only our fake `claude`, placed first on PATH.
	const bin = join(home, "bin");
	mkdirSync(bin, { recursive: true });
	symlinkSync(
		join(root, "tests", "e2e", "fake-claude.sh"),
		join(bin, "claude"),
	);
	writeFileSync(join(home, "claude-counter"), "0");

	const port = 4400 + Math.floor(Math.random() * 100);
	baseUrl = `http://127.0.0.1:${port}`;
	child = spawn(
		"bun",
		["run", "src/cli/index.ts", "run", "--port", String(port), "--no-open"],
		{
			cwd: root,
			stdio: "inherit",
			env: {
				...process.env,
				PATH: `${bin}:${process.env.PATH ?? ""}`,
				NOTAM_HOME: home,
				NOTAM_E2E_TOKEN: "t0ken",
				NOTAM_WEB_DIST: join(root, "web", "dist"),
				NOTAM_FAKE_CLAUDE_COUNTER: join(home, "claude-counter"),
			},
		},
	);

	await waitForServer(baseUrl);
});

test.afterAll(async () => {
	child?.kill("SIGTERM");
	await stub?.close();
	rmSync(home, { recursive: true, force: true });
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
