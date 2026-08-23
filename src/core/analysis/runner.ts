export type RunnerRequest = {
	/** Goes in argv, after -p. */
	instruction: string;
	/** Goes on stdin. Never argv: a busy monolith PR would exceed argv limits. */
	stdin: string;
	model?: string;
	timeoutMs: number;
};

export type RunnerResult =
	| { ok: true; stdout: string }
	| { ok: false; kind: "timeout" | "exit" | "missing"; message: string };

export type ClaudeRunner = (request: RunnerRequest) => Promise<RunnerResult>;

export type RunnerOptions = {
	/** Defaults to resolving "claude" on PATH. */
	bin?: string;
	/** The child's environment, and the PATH the binary is resolved against. */
	env?: Record<string, string | undefined>;
};

/**
 * `--tools ""` disables every built-in tool. Analysis reads text and returns
 * text; it must not be able to touch the filesystem (spec section 6).
 */
export const BASE_ARGS: readonly string[] = [
	"--output-format",
	"json",
	"--tools",
	"",
];

/** The only place in NOTAM that spawns a subprocess. */
export function createClaudeRunner(options: RunnerOptions = {}): ClaudeRunner {
	const env = options.env ?? process.env;

	return async (request: RunnerRequest): Promise<RunnerResult> => {
		const bin =
			options.bin ?? Bun.which("claude", { PATH: env.PATH ?? "" }) ?? null;
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

		const proc = Bun.spawn([bin, ...args], {
			env,
			stdin: new TextEncoder().encode(request.stdin),
			stdout: "pipe",
			stderr: "pipe",
		});

		// A hand-rolled timer rather than Bun.spawn's `timeout`, because the
		// caller has to be able to tell a timeout apart from any other kill: the
		// retry policy differs (spec section 6).
		let timedOut = false;
		const timer = setTimeout(() => {
			timedOut = true;
			proc.kill("SIGKILL");
		}, request.timeoutMs);

		try {
			const [stdout, stderr, exitCode] = await Promise.all([
				new Response(proc.stdout).text(),
				new Response(proc.stderr).text(),
				proc.exited,
			]);

			if (timedOut) {
				return {
					ok: false,
					kind: "timeout",
					message: `claude did not finish within ${request.timeoutMs}ms and was killed`,
				};
			}
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
		}
	};
}
