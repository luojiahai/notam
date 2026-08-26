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
import { type GitHubStub, startGitHubStub } from "./github-stub.ts";

const root = resolve(import.meta.dirname, "..", "..");

export type Harness = {
	baseUrl: string;
	stub: GitHubStub;
	home: string;
	stop: () => Promise<void>;
};

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

/**
 * A real server over a real database, with the stub standing in for
 * GitHub and a fake `claude` first on PATH. Each call owns its own port, home
 * and child process, which is why the Playwright config runs one worker.
 */
export async function startHarness(
	options: { hangingAnalyser?: boolean } = {},
): Promise<Harness> {
	const stub = await startGitHubStub();
	const home = mkdtempSync(join(tmpdir(), "notam-e2e-"));

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
	const baseUrl = `http://127.0.0.1:${port}`;
	let child: ChildProcess | undefined = spawn(
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
				// Whole-server, which is granularity enough: Playwright runs one
				// worker and each harness owns its own child process.
				NOTAM_FAKE_CLAUDE_HANG: options.hangingAnalyser ? "1" : "",
			},
		},
	);

	await waitForServer(baseUrl);

	return {
		baseUrl,
		stub,
		home,
		stop: async () => {
			child?.kill("SIGTERM");
			child = undefined;
			await stub.close();
			rmSync(home, { recursive: true, force: true });
		},
	};
}
