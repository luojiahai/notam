/**
 * The set of platforms NOTAM ships, named the way the release assets are named.
 *
 * One definition, because two would eventually disagree: `scripts/` uses it to
 * decide what to compile and what to call the output, and `core/update/` uses
 * it to decide which asset to download. A drift between those two is a 404 on
 * a real user's machine and on nobody's CI.
 */

/** The Bun target is `bun-` plus one of these, verbatim. */
export const PLATFORMS = [
	"darwin-arm64",
	"darwin-x64",
	"linux-x64",
	"linux-arm64",
] as const;

export type Platform = (typeof PLATFORMS)[number];

export function isPlatform(value: string): value is Platform {
	return (PLATFORMS as readonly string[]).includes(value);
}

/**
 * Under Rosetta `process.arch` reports x64, so an x64 build on Apple silicon
 * keeps resolving to x64. That is the wanted answer for both callers: compile
 * what this machine runs, and update to more of what already runs here.
 */
export function hostPlatform(
	platform: string = process.platform,
	arch: string = process.arch,
): Platform {
	const os =
		platform === "darwin" ? "darwin" : platform === "linux" ? "linux" : null;
	const cpu = arch === "arm64" ? "arm64" : arch === "x64" ? "x64" : null;
	if (os === null || cpu === null) {
		throw new Error(
			`Unsupported platform ${platform}-${arch}. NOTAM ships ${PLATFORMS.join(", ")}.`,
		);
	}
	return `${os}-${cpu}`;
}
