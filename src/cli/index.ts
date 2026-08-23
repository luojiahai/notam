#!/usr/bin/env bun
import type { EventEmitter } from "node:events";
import { homedir } from "node:os";
import { ConfigError } from "../core/config/load.ts";
import { GitHubError } from "../core/github/client.ts";
import { VERSION } from "../version.ts";
import { runInit } from "./init.ts";
import { runRun } from "./run.ts";
import { runSync } from "./sync.ts";

const USAGE = `NOTAM — Notes On Team Agreements & Methods

Usage:
  notam run [--port <n>] [--no-open]  Start the local UI on 127.0.0.1:4317
  notam init [--force]                Write a commented ~/.notam/config.yaml
  notam sync [--repo <owner/repo>]    Sync merged pull requests, then exit
  notam version                       Print the version

Options:
  --port <n>            Bind this exact port instead of the configured one
  --no-open             Do not open a browser
  --repo <owner/repo>   Sync only this repository
  --concurrency <n>     Repositories to sync at once (default 1)
  --force               Overwrite an existing config
  --help                Show this help

Environment:
  NOTAM_HOME            Overrides the home directory holding ~/.notam
  NOTAM_WEB_DIST        Overrides where the built web UI is read from
`;

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
 * Runs `work` with a signal wired to Ctrl-C, so an interrupted sync stops the
 * request it is waiting on rather than being killed mid-flight. The second
 * press is fatal: an abort that itself hangs must not be a worse experience
 * than the ungraceful exit it replaced.
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
	const [command, ...rest] = argv;

	if (command === undefined) {
		log(USAGE);
		return 1;
	}

	// Checked before dispatch, and against the whole argv rather than just the
	// command: `notam init --help` must never write a config, and `notam sync
	// --help` must never attempt a sync.
	if (argv.includes("--help") || argv.includes("-h") || command === "help") {
		log(USAGE);
		return 0;
	}

	try {
		switch (command) {
			case "version":
			case "--version":
				log(VERSION);
				return 0;

			case "run": {
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

			case "init":
				await runInit({ home, force: rest.includes("--force"), log });
				return 0;

			case "sync": {
				const concurrency = Number(flagValue(rest, "--concurrency") ?? 1);
				if (!Number.isInteger(concurrency) || concurrency < 1) {
					throw new ConfigError("--concurrency must be a positive integer");
				}
				const failed = await withInterrupt(log, (signal) =>
					runSync({
						home,
						repoFilter: flagValue(rest, "--repo"),
						concurrency,
						log,
						signal,
					}),
				);
				return failed > 0 ? 1 : 0;
			}

			default:
				console.error(`Unknown command "${command}"\n`);
				console.error(USAGE);
				return 1;
		}
	} catch (error) {
		if (error instanceof ConfigError || error instanceof GitHubError) {
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
