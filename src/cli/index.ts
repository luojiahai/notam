#!/usr/bin/env bun
import { homedir } from "node:os";
import { ConfigError } from "../core/config/load.ts";
import { GitHubError } from "../core/github/client.ts";
import { VERSION } from "../version.ts";
import { runInit } from "./init.ts";
import { runSync } from "./sync.ts";

const USAGE = `NOTAM — Notes On Team Agreements & Methods

Usage:
  notam init [--force]              Write a commented ~/.notam/config.yaml
  notam sync [--repo <owner/repo>]  Sync merged pull requests, then exit
  notam version                     Print the version

Options:
  --repo <owner/repo>   Sync only this repository
  --concurrency <n>     Repositories to sync at once (default 1)
  --force               Overwrite an existing config
  --help                Show this help

Environment:
  NOTAM_HOME            Overrides the home directory holding ~/.notam
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

			case "init":
				await runInit({ home, force: rest.includes("--force"), log });
				return 0;

			case "sync": {
				const concurrency = Number(flagValue(rest, "--concurrency") ?? 1);
				if (!Number.isInteger(concurrency) || concurrency < 1) {
					throw new ConfigError("--concurrency must be a positive integer");
				}
				const failed = await runSync({
					home,
					repoFilter: flagValue(rest, "--repo"),
					concurrency,
					log,
				});
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
