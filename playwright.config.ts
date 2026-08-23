import { defineConfig } from "@playwright/test";

export default defineConfig({
	testDir: "tests/e2e",
	// One worker: each run owns a real port, a real database, and a real
	// child process, and sharing none of them is cheaper than coordinating them.
	workers: 1,
	timeout: 60_000,
	expect: { timeout: 15_000 },
	reporter: process.env.CI ? "list" : "line",
	use: { trace: "retain-on-failure" },
});
