#!/usr/bin/env bun
/**
 * Writes `SHA256SUMS` for the release assets in a directory.
 *
 *   bun run scripts/checksums.ts --dir dist
 *
 * The format is the one `shasum -a 256 -c` and `sha256sum -c` read, and the one
 * `install.sh` greps: a 64-character hex digest, two spaces, the file name.
 */
import { readdir } from "node:fs/promises";
import { join } from "node:path";

export type ChecksumEntry = { name: string; sha256: string };

export function renderChecksums(entries: ChecksumEntry[]): string {
	return `${[...entries]
		.sort((a, b) => a.name.localeCompare(b.name))
		.map((entry) => `${entry.sha256}  ${entry.name}`)
		.join("\n")}\n`;
}

export async function sha256OfFile(path: string): Promise<string> {
	const hasher = new Bun.CryptoHasher("sha256");
	hasher.update(await Bun.file(path).arrayBuffer());
	return hasher.digest("hex");
}

export async function writeChecksums(dir: string): Promise<string> {
	// `notam-` also excludes any SHA256SUMS already sitting there, so re-running
	// is safe and never hashes the manifest into itself.
	const names = (await readdir(dir)).filter((name) =>
		name.startsWith("notam-"),
	);
	if (names.length === 0) {
		throw new Error(`No notam-* files to checksum in ${dir}`);
	}
	const entries: ChecksumEntry[] = [];
	for (const name of names.sort()) {
		entries.push({ name, sha256: await sha256OfFile(join(dir, name)) });
	}
	const text = renderChecksums(entries);
	await Bun.write(join(dir, "SHA256SUMS"), text);
	return text;
}

if (import.meta.main) {
	try {
		const argv = Bun.argv.slice(2);
		const flag = argv.indexOf("--dir");
		const dir = flag === -1 ? "dist" : argv[flag + 1];
		if (dir === undefined || dir.startsWith("--")) {
			throw new Error("--dir needs a value");
		}
		process.stdout.write(await writeChecksums(dir));
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	}
}
