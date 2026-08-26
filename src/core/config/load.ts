import { homedir } from "node:os";
import { join } from "node:path";
import {
	type Config,
	ConfigSchema,
	formatConfigError,
	type HostConfig,
} from "./schema.ts";
import { DEFAULT_CONFIG, renderConfig, writeConfigFileSync } from "./write.ts";

/** Thrown for every condition that must refuse startup with an actionable message. */
export class ConfigError extends Error {
	override name = "ConfigError";
}

/**
 * A submitted config that parsed but cannot be accepted — a prompt template
 * that is not on disk, a rename onto a name already taken. Distinct from
 * ConfigError because this is the caller's mistake, not the environment's.
 */
export class ConfigValidationError extends Error {
	override name = "ConfigValidationError";
}

/** The file changed on disk between the read the caller based its edit on and this write. */
export class ConfigConflictError extends Error {
	override name = "ConfigConflictError";
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

/**
 * Identifies the bytes on disk so a write can tell whether it is editing what
 * it read. Not a cryptographic digest and does not need to be: it detects a
 * change between two reads a second apart, and nothing here is a secret or a
 * security boundary.
 */
export function configHash(text: string): string {
	return Bun.hash(text).toString(16);
}

export function parseConfig(text: string, path: string): Config {
	let raw: unknown;
	try {
		raw = Bun.YAML.parse(text);
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

export async function loadConfig(path: string): Promise<Config> {
	const file = Bun.file(path);
	if (!(await file.exists())) {
		throw new ConfigError(`No config file at ${path}`);
	}
	return parseConfig(await file.text(), path);
}

/**
 * Reads config afresh, with the hash of the bytes it came from.
 *
 * The server holds a boot-time snapshot for the knobs it froze at
 * construction, but the settings surface reads through here on every request:
 * it is a small local file, and it is what makes a hand-edit visible without a
 * restart.
 */
export async function readConfig(
	path: string,
): Promise<{ config: Config; hash: string }> {
	const file = Bun.file(path);
	if (!(await file.exists())) {
		throw new ConfigError(`No config file at ${path}`);
	}
	const text = await file.text();
	return { config: parseConfig(text, path), hash: configHash(text) };
}

/**
 * Writes a default config when there is none, and returns whether it did.
 *
 * Creates, never repairs. A file that exists but does not parse is left
 * exactly as it is: overwriting it would destroy whatever the user was in the
 * middle of typing, and the parse error already names the line to fix.
 */
export async function ensureConfig(path: string): Promise<boolean> {
	if (await Bun.file(path).exists()) return false;
	writeConfigFileSync(path, renderConfig(ConfigSchema.parse(DEFAULT_CONFIG)));
	return true;
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

/** Names the hosts whose token variable is unset, for the warnings the UI shows. */
export function missingTokenHosts(
	config: Config,
	env: Record<string, string | undefined> = process.env,
): HostConfig[] {
	return config.hosts.filter((host) => !env[host.token_env]);
}
