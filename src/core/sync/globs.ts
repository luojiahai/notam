/**
 * A PR is kept when any changed path matches any glob.
 * Empty globs mean the whole repository, so everything is kept.
 */
export function matchesGlobs(paths: string[], globs: string[]): boolean {
	if (globs.length === 0) return true;
	return matchedPrefix(paths, globs) !== null;
}

/** The first glob that matched, for the entry row's secondary line. */
export function matchedPrefix(paths: string[], globs: string[]): string | null {
	for (const glob of globs) {
		const matcher = new Bun.Glob(glob);
		if (paths.some((path) => matcher.match(path))) return glob;
	}
	return null;
}
