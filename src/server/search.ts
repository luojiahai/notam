import type { EntryRow, RuleRow } from "../shared/types.ts";

/**
 * Spec section 9's substring filters, done in memory rather than in SQL.
 *
 * This is a single-user local tool over a few hundred rows per repository, so
 * the query cost is irrelevant, and keeping it out of SQL keeps `store/` free
 * of LIKE-escaping and keeps the matched fields visible in one place.
 */
function normalise(query: string): string | null {
	const trimmed = query.trim().toLowerCase();
	return trimmed === "" ? null : trimmed;
}

/** Title, author, changed path, and PR number — spec section 9's entries tab. */
export function matchesEntryQuery(entry: EntryRow, query: string): boolean {
	const needle = normalise(query);
	if (needle === null) return true;
	if (entry.title.toLowerCase().includes(needle)) return true;
	if (entry.author.toLowerCase().includes(needle)) return true;
	if (String(entry.number).includes(needle)) return true;
	return entry.changed_paths.some((path) =>
		path.toLowerCase().includes(needle),
	);
}

/** Directive text is what the rules tab filters on; rationale is included because it is on screen. */
export function matchesRuleQuery(rule: RuleRow, query: string): boolean {
	const needle = normalise(query);
	if (needle === null) return true;
	return (
		rule.directive.toLowerCase().includes(needle) ||
		rule.rationale.toLowerCase().includes(needle)
	);
}
