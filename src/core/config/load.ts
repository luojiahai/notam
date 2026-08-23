import { homedir } from "node:os";
import { join } from "node:path";
import {
	type Config,
	ConfigSchema,
	formatConfigError,
	type HostConfig,
} from "./schema.ts";

/** Thrown for every condition that must refuse startup with an actionable message. */
export class ConfigError extends Error {
	override name = "ConfigError";
}

export function expandHome(path: string, home: string = homedir()): string {
	if (path === "~") return home;
	if (path.startsWith("~/")) return join(home, path.slice(2));
	return path;
}

export function notamDir(home: string = homedir()): string {
	return join(home, ".notam");
}

export function defaultConfigPath(home: string = homedir()): string {
	return join(notamDir(home), "config.yaml");
}

export function defaultDbPath(home: string = homedir()): string {
	return join(notamDir(home), "notam.db");
}

export async function loadConfig(path: string): Promise<Config> {
	const file = Bun.file(path);
	if (!(await file.exists())) {
		throw new ConfigError(
			`No config file at ${path}\nRun \`notam init\` to create one.`,
		);
	}

	let raw: unknown;
	try {
		raw = Bun.YAML.parse(await file.text());
	} catch (cause) {
		throw new ConfigError(
			`${path} is not valid YAML: ${cause instanceof Error ? cause.message : String(cause)}`,
		);
	}

	const result = ConfigSchema.safeParse(raw);
	if (!result.success) {
		throw new ConfigError(
			`${path} is not a valid NOTAM config:\n${formatConfigError(result.error)}`,
		);
	}
	return result.data;
}

/**
 * Tokens live only in the environment. The config stores the variable's name,
 * never its value, so a leaked config.yaml leaks nothing.
 */
export function resolveToken(
	host: HostConfig,
	env: Record<string, string | undefined> = process.env,
): string {
	const token = env[host.token_env];
	if (!token) {
		throw new ConfigError(
			`Environment variable ${host.token_env} is not set.\nIt supplies the API token for host "${host.id}" (${host.api_base}).`,
		);
	}
	return token;
}
