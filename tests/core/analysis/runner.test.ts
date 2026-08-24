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
		// A shell running `sleep 30` as its last command still forks a real
		// child to run it — `ps` shows a distinct pid for `sleep`, with the
		// shell as its parent, on both bash and dash. So a bare trailing
		// `sleep 30` already produces the grandchild this test needs; nothing
		// here relies on defeating a shell optimisation, because there isn't
		// one to defeat. `&` then `wait` is belt-and-braces: it makes that
		// fork unconditional and timing-independent — the shell has to keep
		// running past the backgrounded job (into `wait`), so there is no way
		// for it to still be executing `sleep` itself when it's killed. That
		// grandchild surviving a SIGKILL to the shell, still holding the
		// stdout/stderr pipes open, is exactly the scenario (`claude` as a
		// forking wrapper script) the runner has to survive.
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
			// leaves comfortable headroom for that startup cost everywhere.
			timeoutMs: 2000,
		});
		const elapsedMs = (Bun.nanoseconds() - started) / 1e6;

		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("expected a failure");
		expect(result.kind).toBe("timeout");
		expect(result.message).toContain("2000ms");
		// Deliberately loose: a hung process here means ~30s (the fake's
		// `sleep 30`), so anything under several seconds already tells the two
		// cases apart decisively. Kept at 5000, not tightened toward the
		// 2000ms timeout, to leave headroom against scheduler contention on a
		// shared CI runner rather than trade a flaky gate for a tighter bound.
		expect(elapsedMs).toBeLessThan(5000);
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
	test("kills a hung process and reports an abort when its signal fires", async () => {
		// The same forking wrapper as the timeout test: a grandchild that
		// outlives a SIGKILL to the shell and keeps the pipes open. Cancelling
		// has to win a race against the reads for exactly the reason the
		// timeout does, so it is proven against the same shape of process.
		await fakeClaude(`/bin/sleep 30 &\nwait`);
		const controller = new AbortController();
		// Fired once the child is certainly running, so the abort exercises the
		// listener rather than the pre-spawn check.
		setTimeout(() => controller.abort(), 2000);

		const started = Bun.nanoseconds();
		const result = await runner()({
			instruction: "I",
			stdin: "P",
			// Far beyond the abort, so a pass cannot come from the timeout.
			timeoutMs: 60_000,
			signal: controller.signal,
		});
		const elapsedMs = (Bun.nanoseconds() - started) / 1e6;

		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("expected a failure");
		expect(result.kind).toBe("aborted");
		expect(elapsedMs).toBeLessThan(5000);
	});

	test("reports an abort without spawning when its signal is already fired", async () => {
		await fakeClaude("echo unreachable");
		const result = await runner()({
			instruction: "I",
			stdin: "P",
			timeoutMs: 5000,
			signal: AbortSignal.abort(),
		});

		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("expected a failure");
		expect(result.kind).toBe("aborted");
		// The fake writes this on every invocation, so its absence is proof
		// that nothing was executed.
		expect(await Bun.file(join(dir, "argv.txt")).exists()).toBe(false);
	});
});
