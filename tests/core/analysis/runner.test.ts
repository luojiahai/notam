import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClaudeRunner } from "../../../src/core/analysis/runner.ts";

let dir: string;

/**
 * Writes a fake `claude` into `dir` and puts that directory on the runner's
 * PATH. The fake records the argv it saw (each argument bracketed, so an empty
 * one is visible) and the stdin it was piped, then runs `body`.
 *
 * `cat` and `sleep` are called by absolute path on purpose: the child's PATH is
 * ONLY `dir`, because the "missing claude" test needs a PATH with no claude on
 * it, and a bare `cat` would then fail with "command not found" and silently
 * record empty stdin.
 */
async function fakeClaude(body: string): Promise<void> {
	const script = `#!/bin/sh
out=""
sep=""
for a in "$@"; do out="$out$sep[$a]"; sep=" "; done
printf '%s' "$out" > "${dir}/argv.txt"
/bin/cat > "${dir}/stdin.txt"
${body}
`;
	const path = join(dir, "claude");
	await Bun.write(path, script);
	await chmod(path, 0o755);
}

function runner(options: { bin?: string } = {}) {
	return createClaudeRunner({ ...options, env: { PATH: dir } });
}

beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "notam-runner-"));
});
afterEach(async () => {
	await rm(dir, { recursive: true, force: true });
});

describe("createClaudeRunner", () => {
	test("passes the instruction in argv, disables every tool, and asks for JSON", async () => {
		await fakeClaude(`printf '{"result":"ok"}'`);
		const result = await runner()({
			instruction: "INSTRUCTION",
			stdin: "PAYLOAD",
			timeoutMs: 5000,
		});

		expect(result).toEqual({ ok: true, stdout: '{"result":"ok"}' });
		const argv = await Bun.file(join(dir, "argv.txt")).text();
		expect(argv).toContain("[-p] [INSTRUCTION]");
		expect(argv).toContain("[--output-format] [json]");
		// The empty argument is the point: `--tools ""` disables all tools.
		expect(argv).toContain("[--tools] []");
		expect(argv).not.toContain("[--model]");
	});

	test("pipes the payload on stdin rather than inlining it in argv", async () => {
		await fakeClaude(`printf '{"result":"ok"}'`);
		const payload = "x".repeat(300_000);
		const result = await runner()({
			instruction: "INSTRUCTION",
			stdin: payload,
			timeoutMs: 5000,
		});

		expect(result.ok).toBe(true);
		expect(await Bun.file(join(dir, "stdin.txt")).text()).toBe(payload);
		expect(await Bun.file(join(dir, "argv.txt")).text()).not.toContain(payload);
	});

	test("passes a configured model through", async () => {
		await fakeClaude(`printf '{"result":"ok"}'`);
		await runner()({
			instruction: "I",
			stdin: "P",
			model: "claude-sonnet-5",
			timeoutMs: 5000,
		});
		expect(await Bun.file(join(dir, "argv.txt")).text()).toContain(
			"[--model] [claude-sonnet-5]",
		);
	});

	test("reports a non-zero exit with the exit code and stderr", async () => {
		await fakeClaude(`echo "credit balance too low" >&2\nexit 3`);
		const result = await runner()({
			instruction: "I",
			stdin: "P",
			timeoutMs: 5000,
		});

		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("expected a failure");
		expect(result.kind).toBe("exit");
		expect(result.message).toContain("3");
		expect(result.message).toContain("credit balance too low");
	});

	test("kills a hung process and reports a timeout", async () => {
		// Backgrounding with `&` then `wait`, not a bare `sleep 30`: a shell
		// exec-optimises a command that is its last action (bash does this for
		// a plain trailing `sleep 30`, so the shell process *becomes* sleep and
		// a SIGKILL to the direct child lands squarely on it). `&` forces a real
		// fork on every POSIX shell — the script has to keep running after it
		// (into `wait`), so the shell can't replace itself with sleep. That
		// leaves a grandchild that survives a SIGKILL to the shell and keeps
		// holding the stdout/stderr pipes open, which is exactly the scenario
		// (`claude` as a forking wrapper script) the runner has to survive.
		await fakeClaude(`/bin/sleep 30 &\nwait`);
		const started = Bun.nanoseconds();
		const result = await runner()({
			instruction: "I",
			stdin: "P",
			// 2000, not 200: on some hosts (observed locally on macOS) the very
			// first exec of a freshly-written, freshly-chmod'd script carries a
			// few hundred ms of OS-level overhead before the shell runs a single
			// instruction — nothing to do with this bug. At 200ms that overhead
			// alone can beat the kill to the punch, so the shell never reaches
			// `sleep 30 &` and no grandchild is ever created — the test would
			// then "pass" for the wrong reason even against the bug. 2000ms
			// leaves comfortable headroom for that startup cost everywhere,
			// while still containing "200" for the assertion below.
			timeoutMs: 2000,
		});
		const elapsedMs = (Bun.nanoseconds() - started) / 1e6;

		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("expected a failure");
		expect(result.kind).toBe("timeout");
		expect(result.message).toContain("200");
		// Loose enough to absorb scheduler/CI jitter, but tight enough that a
		// return path which waits out the grandchild (the bug) still fails it:
		// that path doesn't return until the 30s `sleep` exits.
		expect(elapsedMs).toBeLessThan(3000);
	});

	test("reports a missing claude CLI without throwing", async () => {
		const result = await runner()({
			instruction: "I",
			stdin: "P",
			timeoutMs: 5000,
		});
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("expected a failure");
		expect(result.kind).toBe("missing");
		expect(result.message).toContain("claude");
	});

	test("honours an explicit binary path", async () => {
		await fakeClaude(`printf '{"result":"ok"}'`);
		const explicit = join(dir, "claude");
		const result = await createClaudeRunner({
			bin: explicit,
			env: { PATH: "" },
		})({
			instruction: "I",
			stdin: "P",
			timeoutMs: 5000,
		});
		expect(result.ok).toBe(true);
	});

	test("reports a missing claude CLI at an explicitly configured path without throwing", async () => {
		const explicit = join(dir, "does-not-exist");
		const result = await createClaudeRunner({
			bin: explicit,
			env: { PATH: "" },
		})({
			instruction: "I",
			stdin: "P",
			timeoutMs: 5000,
		});
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("expected a failure");
		expect(result.kind).toBe("missing");
		expect(result.message).toContain(explicit);
	});
});
