#!/usr/bin/env bun
import type { EventEmitter } from "node:events";
import { homedir } from "node:os";
import { ConfigError } from "../core/config/load.ts";
import { GitHubError } from "../core/github/client.ts";
import { UpdateError } from "../core/update/index.ts";
import { VERSION } from "../version.ts";
import { runRun } from "./run.ts";
import { runUpdateCommand } from "./update.ts";

const USAGE = `NOTAM — Notes On Team Agreements & Methods

Usage:
  notam [--port <n>] [--no-open]      Start the local UI on 127.0.0.1:4317
  notam update [--version <tag>]      Replace this binary with a newer release
  notam version                       Print the version

Options:
  --port <n>            Bind this exact port instead of the configured one
  --no-open             Do not open a browser
  --version <tag>       Update to this release instead of the latest
  --force               Reinstall the version already running (update)
  --help                Show this help

Environment:
  NOTAM_HOME            Overrides the home directory holding ~/.notam
  NOTAM_WEB_DIST        Overrides where the built web UI is read from
  NOTAM_REPO            owner/repo that notam update installs from
  NOTAM_API_BASE        GitHub API base URL that notam update resolves releases on
  NOTAM_DOWNLOAD_BASE   Release download base URL that notam update fetches from
`;

/**
 * Words this CLI answers to without accepting.
 *
 * Each names what to do instead, because a bare "Unknown command" is a dead
 * end for anyone who typed it from a script, a shell history, or muscle
 * memory. Keep them reserved: a future command that reuses one of these
 * spellings would silently mean something else to everyone still typing it.
 */
const RESERVED: Record<string, string> = {
	run: "`notam` on its own starts the server.",
	init: "There is nothing to initialise: config is created on first run, and edited in the settings drawer or in ~/.notam/config.yaml.",
	sync: "Sync from the UI, or:\n  curl -X POST http://127.0.0.1:4317/api/repos/<id>/sync",
};

/** Tests point this at a temporary directory instead of the real home. */
export function resolveHome(
	env: Record<string, string | undefined> = process.env,
): string {
	return env.NOTAM_HOME ?? homedir();
}

function flagValue(argv: string[], flag: string): string | undefined {
	const index = argv.indexOf(flag);
	if (index === -1) return undefined;
	const value = argv[index + 1];
	if (value === undefined || value.startsWith("--"))
		throw new ConfigError(`${flag} needs a value`);
	return value;
}

/**
 * Runs `work` with a signal wired to Ctrl-C, so an interrupted update stops the
 * request it is waiting on rather than being killed mid-flight.
 *
 * The second press exits immediately, and must: an abort can itself hang on a
 * socket that will not close, and the user needs a way out that does not
 * depend on the thing they are trying to escape.
 */
async function withInterrupt<T>(
	log: (line: string) => void,
	work: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
	const controller = new AbortController();
	let stopping = false;
	const onInterrupt = () => {
		if (stopping) process.exit(130);
		stopping = true;
		log("");
		log("Stopping. Press Ctrl-C again to exit immediately.");
		controller.abort();
	};
	process.on("SIGINT", onInterrupt);
	try {
		return await work(controller.signal);
	} finally {
		// `process.off` is typed only for Bun's own events. The same object seen
		// as an EventEmitter carries the general signature.
		(process as EventEmitter).removeListener("SIGINT", onInterrupt);
	}
}

export async function main(
	argv: string[],
	env: Record<string, string | undefined> = process.env,
): Promise<number> {
	const log = (line: string) => console.log(line);
	const home = resolveHome(env);

	// Only argv[0] can be a command, so a leading flag means there is none and
	// the server is what was asked for. Scanning further would take `--port`'s
	// own value for a command.
	const first = argv[0];
	const command =
		first === undefined || first.startsWith("-") ? undefined : first;
	const rest = command === undefined ? argv : argv.slice(1);

	// `--version` is the flag spelling of the command, but only in first
	// position: `notam update --version v1.2.3` means something else entirely.
	if (first === "--version") {
		log(VERSION);
		return 0;
	}

	// Checked before dispatch, and against the whole argv rather than just the
	// command, so `notam update --help` never attempts an update.
	if (argv.includes("--help") || argv.includes("-h") || command === "help") {
		log(USAGE);
		return 0;
	}

	try {
		switch (command) {
			case undefined: {
				const raw = flagValue(rest, "--port");
				const port = raw === undefined ? undefined : Number(raw);
				if (
					port !== undefined &&
					(!Number.isInteger(port) || port < 1 || port > 65535)
				) {
					throw new ConfigError(
						"--port must be an integer between 1 and 65535",
					);
				}
				return await runRun({
					home,
					port,
					open: !rest.includes("--no-open"),
					log,
					env,
				});
			}

			case "version":
				log(VERSION);
				return 0;

			case "update": {
				const requested = flagValue(rest, "--version");
				await withInterrupt(log, (signal) =>
					runUpdateCommand({
						...(requested === undefined ? {} : { requestedVersion: requested }),
						force: rest.includes("--force"),
						log,
						env,
						signal,
					}),
				);
				return 0;
			}

			default: {
				const reserved = RESERVED[command];
				console.error(reserved ?? `Unknown command "${command}"\n`);
				if (reserved === undefined) console.error(USAGE);
				return 1;
			}
		}
	} catch (error) {
		if (
			error instanceof ConfigError ||
			error instanceof GitHubError ||
			error instanceof UpdateError
		) {
			console.error(error.message);
		} else {
			console.error(
				error instanceof Error ? (error.stack ?? error.message) : String(error),
			);
		}
		return 1;
	}
}

if (import.meta.main) {
	process.exit(await main(Bun.argv.slice(2)));
}
