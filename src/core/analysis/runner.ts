export type RunnerRequest = {
	/** Goes in argv, after -p. */
	instruction: string;
	/** Goes on stdin. Never argv: a busy monolith PR would exceed argv limits. */
	stdin: string;
	model?: string;
	timeoutMs: number;
	/** Fires to stop this run: the child is killed and `kind: "aborted"` returned. */
	signal?: AbortSignal;
};

export type RunnerResult =
	| { ok: true; stdout: string }
	| {
			ok: false;
			kind: "timeout" | "exit" | "missing" | "aborted";
			message: string;
	  };

export type ClaudeRunner = (request: RunnerRequest) => Promise<RunnerResult>;

export type RunnerOptions = {
	/** Defaults to resolving "claude" on PATH. */
	bin?: string;
	/** The child's environment, and the PATH the binary is resolved against. */
	env?: Record<string, string | undefined>;
};

/**
 * `--tools ""` disables every built-in tool. Analysis reads text and returns
 * text; it must not be able to touch the filesystem.
 */
export const BASE_ARGS: readonly string[] = Object.freeze([
	"--output-format",
	"json",
	"--tools",
	"",
]);

/** The only place in NOTAM that spawns a subprocess. */
export function createClaudeRunner(options: RunnerOptions = {}): ClaudeRunner {
	const env = options.env ?? process.env;

	return async (request: RunnerRequest): Promise<RunnerResult> => {
		// Checked before resolving the binary, let alone spawning: a run that
		// was cancelled before it began must not start a subprocess only to
		// kill it a moment later.
		if (request.signal?.aborted) return abortedResult();

		const bin = options.bin ?? Bun.which("claude", { PATH: env.PATH ?? "" });
		if (!bin) {
			return {
				ok: false,
				kind: "missing",
				message:
					"The claude CLI was not found on PATH. Install it from https://claude.com/claude-code",
			};
		}

		const args = [
			"-p",
			request.instruction,
			...BASE_ARGS,
			...(request.model ? ["--model", request.model] : []),
		];

		// Bun.spawn throws synchronously (e.g. ENOENT) when `bin` is an explicit
		// path that does not resolve to an executable — Bun.which already
		// guards the PATH-resolution case, but an explicit `options.bin` skips
		// that guard. Caught here so a bad path is reported as `{ ok: false,
		// kind: "missing" }` rather than a rejected promise: callers rely on
		// `RunnerResult` never throwing to decide retry policy.
		let spawnError: unknown;
		const spawn = () => {
			try {
				return Bun.spawn([bin, ...args], {
					env,
					stdin: new TextEncoder().encode(request.stdin),
					stdout: "pipe",
					stderr: "pipe",
				});
			} catch (cause) {
				spawnError = cause;
				return null;
			}
		};
		const proc = spawn();
		if (!proc) {
			return {
				ok: false,
				kind: "missing",
				message: `claude could not be executed at "${bin}": ${spawnError instanceof Error ? spawnError.message : String(spawnError)}`,
			};
		}

		// A hand-rolled timer rather than Bun.spawn's `timeout`, because the
		// caller has to be able to tell a timeout apart from any other kill: the
		// retry policy differs. Cancellation kills the child the same way and is
		// subject to everything below in equal measure.
		//
		// `proc.kill("SIGKILL")` only signals the direct child. If `claude` is a
		// shell wrapper, the shell may fork rather than exec its own work, and a
		// SIGKILL to the shell does not reach that grandchild — which can then
		// outlive the kill and keep the stdout/stderr pipes' write ends open
		// indefinitely. Reading those pipes to completion (`Promise.all`) would
		// then hang until the grandchild happens to exit on its own, well past
		// `timeoutMs`. So a kill has to *win a race* against the pipe reads,
		// not wait alongside them: once one fires, the reads are abandoned
		// rather than awaited. A cancellation that awaited them would hang for
		// as long as the timeout would have, which is the whole thing the
		// user's stop press is trying to avoid.
		//
		// Known limitation: Bun.spawn has no `detached`/process-group option, so
		// there is no way here to kill that grandchild. The race above stops
		// NOTAM from *hanging* on it; the orphaned process itself still lingers
		// until it exits on its own.
		let timer: ReturnType<typeof setTimeout> | undefined;
		let onAbort: (() => void) | undefined;
		try {
			const stdoutReader = proc.stdout.getReader();
			const stderrReader = proc.stderr.getReader();

			const reads = Promise.all([
				readAll(stdoutReader),
				readAll(stderrReader),
				proc.exited,
			]);

			const timedOut = new Promise<true>((resolve) => {
				timer = setTimeout(() => {
					proc.kill("SIGKILL");
					resolve(true);
				}, request.timeoutMs);
			});

			// Never resolves without a signal, which is what leaves the race to
			// the other two.
			const cancelled = new Promise<"aborted">((resolve) => {
				if (!request.signal) return;
				onAbort = () => {
					proc.kill("SIGKILL");
					resolve("aborted");
				};
				request.signal.addEventListener("abort", onAbort, { once: true });
			});

			const outcome = await Promise.race([reads, timedOut, cancelled]);

			if (outcome === true || outcome === "aborted") {
				// The race was won by a kill, not the reads: `reads` may still
				// be pending (a surviving grandchild holding the pipes) or about
				// to settle on its own. Either way it's abandoned here, so (a)
				// attach a handler so its eventual settlement — resolve or
				// reject — never surfaces as an unhandled rejection, and (b)
				// cancel the readers so Bun releases our end of the pipes now
				// instead of leaking them for as long as the grandchild lives.
				reads.catch(() => {});
				stdoutReader.cancel().catch(() => {});
				stderrReader.cancel().catch(() => {});
				return outcome === "aborted"
					? abortedResult()
					: {
							ok: false,
							kind: "timeout",
							message: `claude did not finish within ${request.timeoutMs}ms and was killed`,
						};
			}

			const [stdout, stderr, exitCode] = outcome;
			if (exitCode !== 0) {
				return {
					ok: false,
					kind: "exit",
					message: `claude exited with code ${exitCode}: ${stderr.trim() || stdout.trim() || "(no output)"}`,
				};
			}
			return { ok: true, stdout };
		} finally {
			clearTimeout(timer);
			// One signal covers every attempt a single analysis makes, so a
			// listener left behind here would accumulate across all of them.
			if (onAbort) request.signal?.removeEventListener("abort", onAbort);
		}
	};
}

function abortedResult(): RunnerResult {
	return { ok: false, kind: "aborted", message: "claude was cancelled" };
}

/** Reads a stream to completion and decodes it as UTF-8, like `Response.text()`. */
async function readAll(
	reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<string> {
	const chunks: Uint8Array[] = [];
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		if (value) chunks.push(value);
	}
	return Buffer.concat(chunks).toString("utf8");
}
