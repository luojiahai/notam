import { chmod, mkdir } from "node:fs/promises";
import {
	ConfigError,
	defaultConfigPath,
	notamDir,
} from "../core/config/load.ts";
import { CONFIG_TEMPLATE } from "../core/config/template.ts";

export type InitOptions = {
	home: string;
	force: boolean;
	log: (line: string) => void;
};

export async function runInit({
	home,
	force,
	log,
}: InitOptions): Promise<void> {
	const dir = notamDir(home);
	const path = defaultConfigPath(home);

	await mkdir(dir, { recursive: true, mode: 0o700 });
	await chmod(dir, 0o700);

	if (!force && (await Bun.file(path).exists())) {
		throw new ConfigError(
			`${path} already exists.\nRe-run with --force to replace it.`,
		);
	}

	await Bun.write(path, CONFIG_TEMPLATE);
	await chmod(path, 0o600);
	log(`Wrote ${path}`);

	if (Bun.which("claude")) {
		log("Found the claude CLI on PATH.");
	} else {
		log(
			"Warning: the claude CLI was not found on PATH. NOTAM needs it to analyse entries.",
		);
		log("  Install it from https://claude.com/claude-code");
	}

	log("");
	log("Next:");
	log(`  1. Edit ${path} — set your host and the repositories your team owns.`);
	log("  2. Export the token environment variable each host names.");
	log("  3. Run `notam sync`.");
}
