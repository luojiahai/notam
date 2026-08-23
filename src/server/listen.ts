export type ListenOptions = {
	fetch: (request: Request) => Response | Promise<Response>;
	port: number;
	/** True for the configured default, false for an explicit --port. */
	autoIncrement: boolean;
	maxAttempts?: number;
};

export type Listener = {
	port: number;
	url: string;
	stop: () => Promise<void>;
};

function isAddressInUse(error: unknown): boolean {
	if (typeof error !== "object" || error === null) return false;
	const code = (error as { code?: unknown }).code;
	if (code === "EADDRINUSE") return true;
	const message = (error as { message?: unknown }).message;
	return typeof message === "string" && message.includes("EADDRINUSE");
}

/**
 * `127.0.0.1` only, auto-incrementing if the port is taken.
 *
 * The hostname is not configurable. There is no authentication layer, so a
 * routable bind would expose a user's GitHub token surface to their network,
 * and no flag should be able to ask for that.
 *
 * Auto-increment applies to the *default* port only. A user who typed
 * `--port 8080` asked for 8080, and silently answering on 8081 would send them
 * to a page that is not theirs.
 */
export function listen(options: ListenOptions): Listener {
	const maxAttempts = options.autoIncrement ? (options.maxAttempts ?? 20) : 1;
	let lastError: unknown;

	for (let attempt = 0; attempt < maxAttempts; attempt++) {
		try {
			const server = Bun.serve({
				hostname: "127.0.0.1",
				port: options.port + attempt,
				fetch: options.fetch,
			});
			// `Server["port"]` is typed `number | undefined` because Bun.serve's
			// return type also covers unix-socket listeners; a TCP listener like
			// this one always has one.
			const port = server.port;
			if (port === undefined) {
				throw new Error("Bun.serve did not return a port for a TCP listener");
			}
			return {
				port,
				url: `http://127.0.0.1:${port}`,
				stop: async () => {
					await server.stop(true);
				},
			};
		} catch (error) {
			if (!isAddressInUse(error)) throw error;
			lastError = error;
		}
	}

	const range = options.autoIncrement
		? `${options.port}–${options.port + maxAttempts - 1}`
		: String(options.port);
	throw new Error(
		`Could not bind 127.0.0.1 on port ${range}: ${
			lastError instanceof Error ? lastError.message : String(lastError)
		}`,
	);
}
