/**
 * ISO, not a locale format: a column of dates should sort by eye, read the
 * same in every timezone, and never move under a test.
 */
export function day(timestamp: string | null): string | null {
	return timestamp === null ? null : timestamp.slice(0, 10);
}
