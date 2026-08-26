import {
	ReleaseClient,
	releaseSourceFromEnv,
} from "../core/github/releases.ts";
import { runUpdate, UpdateError } from "../core/update/index.ts";
import { hostPlatform, type Platform } from "../shared/platform.ts";
import { VERSION } from "../version.ts";

export type UpdateCommandOptions = {
	requestedVersion?: string;
	force: boolean;
	log: (line: string) => void;
	env?: Record<string, string | undefined>;
	signal?: AbortSignal;
};

export async function runUpdateCommand(
	options: UpdateCommandOptions,
): Promise<void> {
	const env = options.env ?? process.env;
	let platform: Platform;
	try {
		platform = hostPlatform();
	} catch (error) {
		throw new UpdateError(
			error instanceof Error ? error.message : String(error),
		);
	}

	try {
		await runUpdate({
			client: new ReleaseClient(releaseSourceFromEnv(env)),
			platform,
			currentVersion: VERSION,
			execPath: process.execPath,
			...(options.requestedVersion === undefined
				? {}
				: { requestedVersion: options.requestedVersion }),
			force: options.force,
			log: options.log,
			...(options.signal ? { signal: options.signal } : {}),
		});
	} catch (error) {
		// An aborted fetch throws a bare AbortError, which would otherwise reach
		// the user as a stack trace for having pressed Ctrl-C.
		if (error instanceof Error && error.name === "AbortError") {
			throw new UpdateError("Update cancelled. Nothing was installed.");
		}
		throw error;
	}
}
