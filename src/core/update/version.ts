/** `[major, minor, patch]`. */
export type Version = [number, number, number];

const PATTERN = /^v?(\d+)\.(\d+)\.(\d+)$/;

/**
 * Returns null for anything that is not exactly three numbers — `dev`, a
 * prerelease like `0.2.0-rc.1`, a hand-cut tag. The caller refuses rather than
 * guessing which of two unorderable strings is newer.
 */
export function parseVersion(value: string): Version | null {
	const match = PATTERN.exec(value);
	if (match === null) return null;
	const [, major, minor, patch] = match;
	if (major === undefined || minor === undefined || patch === undefined) {
		return null;
	}
	return [Number(major), Number(minor), Number(patch)];
}

/** Negative if `a` precedes `b`, positive if it follows, zero if they match. */
export function compareVersions(a: Version, b: Version): number {
	for (let index = 0; index < 3; index++) {
		// Component-wise and numeric. Comparing the strings instead would put
		// 0.1.10 before 0.1.9 and refuse a real upgrade as a downgrade.
		const difference = (a[index] ?? 0) - (b[index] ?? 0);
		if (difference !== 0) return difference;
	}
	return 0;
}

/** Release tags are `v`-prefixed; a version on its own is not. */
export function tagFor(version: string): string {
	return version.startsWith("v") ? version : `v${version}`;
}
