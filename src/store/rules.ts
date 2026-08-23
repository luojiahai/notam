import type { Database } from "bun:sqlite";
import { newId } from "../shared/ids.ts";
import type {
	NewRule,
	RuleKind,
	RuleRow,
	RuleStatus,
} from "../shared/types.ts";

const STATUSES: RuleStatus[] = ["draft", "proposed", "verified", "abandoned"];

type RawRule = {
	id: string;
	repo_id: string;
	entry_id: string;
	kind: string;
	directive: string;
	rationale: string;
	scope_globs: string;
	confidence: number;
	source_comment_urls: string;
	status: string;
	promotion_id: string | null;
	file_slug: string;
	created_at: string;
	status_changed_at: string;
};

function hydrate(raw: RawRule): RuleRow {
	return {
		...raw,
		kind: raw.kind as RuleKind,
		status: raw.status as RuleStatus,
		scope_globs: JSON.parse(raw.scope_globs) as string[],
		source_comment_urls: JSON.parse(raw.source_comment_urls) as string[],
	};
}

/** Every rule is born a `draft`: it exists nowhere but NOTAM until it is promoted. */
export function insertRules(
	db: Database,
	repoId: string,
	entryId: string,
	rules: NewRule[],
	now: Date,
): RuleRow[] {
	if (rules.length === 0) return [];
	const timestamp = now.toISOString();
	return db.transaction(() => {
		const ids: string[] = [];
		for (const rule of rules) {
			const id = newId("ru", now.getTime());
			ids.push(id);
			db.query(
				`INSERT INTO rules (id, repo_id, entry_id, kind, directive, rationale, scope_globs, confidence, source_comment_urls, status, promotion_id, file_slug, created_at, status_changed_at)
				 VALUES ($id, $repo_id, $entry_id, $kind, $directive, $rationale, $scope_globs, $confidence, $source_comment_urls, 'draft', NULL, $file_slug, $created_at, $created_at)`,
			).run({
				$id: id,
				$repo_id: repoId,
				$entry_id: entryId,
				$kind: rule.kind,
				$directive: rule.directive,
				$rationale: rule.rationale,
				$scope_globs: JSON.stringify(rule.scope_globs),
				$confidence: rule.confidence,
				$source_comment_urls: JSON.stringify(rule.source_comment_urls),
				$file_slug: rule.file_slug,
				$created_at: timestamp,
			});
		}
		return ids
			.map((id) => getRule(db, id))
			.filter((row): row is RuleRow => row !== null);
	})();
}

export function getRule(db: Database, id: string): RuleRow | null {
	const raw = db
		.query<RawRule, [string]>("SELECT * FROM rules WHERE id = ?")
		.get(id);
	return raw ? hydrate(raw) : null;
}

export function listRules(
	db: Database,
	repoId: string,
	options: { status?: RuleStatus } = {},
): RuleRow[] {
	const rows = options.status
		? db
				.query<RawRule, [string, string]>(
					"SELECT * FROM rules WHERE repo_id = ? AND status = ? ORDER BY created_at DESC, id DESC",
				)
				.all(repoId, options.status)
		: db
				.query<RawRule, [string]>(
					"SELECT * FROM rules WHERE repo_id = ? ORDER BY created_at DESC, id DESC",
				)
				.all(repoId);
	return rows.map(hydrate);
}

export function listRulesByEntry(db: Database, entryId: string): RuleRow[] {
	return db
		.query<RawRule, [string]>(
			"SELECT * FROM rules WHERE entry_id = ? ORDER BY created_at, id",
		)
		.all(entryId)
		.map(hydrate);
}

export function listRulesByPromotion(
	db: Database,
	promotionId: string,
): RuleRow[] {
	return db
		.query<RawRule, [string]>(
			"SELECT * FROM rules WHERE promotion_id = ? ORDER BY created_at, id",
		)
		.all(promotionId)
		.map(hydrate);
}

/**
 * Ordered by creation, not by the caller's array order, so a promotion built
 * from the same selection always assigns the same collision suffixes.
 */
export function listRulesByIds(db: Database, ids: string[]): RuleRow[] {
	if (ids.length === 0) return [];
	const placeholders = ids.map(() => "?").join(",");
	return db
		.query<RawRule, string[]>(
			`SELECT * FROM rules WHERE id IN (${placeholders}) ORDER BY created_at, id`,
		)
		.all(...ids)
		.map(hydrate);
}

export function countRulesByStatus(
	db: Database,
	repoId: string,
): Record<RuleStatus, number> {
	const counts = Object.fromEntries(
		STATUSES.map((status) => [status, 0]),
	) as Record<RuleStatus, number>;
	const rows = db
		.query<{ status: string; c: number }, [string]>(
			"SELECT status, COUNT(*) AS c FROM rules WHERE repo_id = ? GROUP BY status",
		)
		.all(repoId);
	for (const row of rows) counts[row.status as RuleStatus] = row.c;
	return counts;
}

/** Re-analysis discards drafts and nothing else. */
export function deleteDraftRulesForEntry(
	db: Database,
	entryId: string,
): number {
	return db
		.query("DELETE FROM rules WHERE entry_id = ? AND status = 'draft'")
		.run(entryId).changes;
}

function countBy(
	db: Database,
	column: "entry_id" | "promotion_id",
	ids: string[],
	status?: RuleStatus,
): Record<string, number> {
	if (ids.length === 0) return {};
	// Zero-filled so a caller can index the result directly rather than
	// remembering to coalesce; the column name is a literal from this
	// function's own signature, never caller text.
	const counts: Record<string, number> = {};
	for (const id of ids) counts[id] = 0;
	const placeholders = ids.map(() => "?").join(",");
	const clause = status ? " AND status = ?" : "";
	const params = status ? [...ids, status] : ids;
	const rows = db
		.query<{ key: string; c: number }, string[]>(
			`SELECT ${column} AS key, COUNT(*) AS c FROM rules WHERE ${column} IN (${placeholders})${clause} GROUP BY ${column}`,
		)
		.all(...params);
	for (const row of rows) counts[row.key] = row.c;
	return counts;
}

/**
 * How many rules each entry produced. Pass a status to count only those —
 * `"draft"` is what the re-analysis confirmation dialog needs, because drafts
 * are the only rules a re-run discards.
 */
export function countRulesByEntryIds(
	db: Database,
	ids: string[],
	status?: RuleStatus,
): Record<string, number> {
	return countBy(db, "entry_id", ids, status);
}

/** How many rules each promotion carries, for the sidebar's badges. */
export function countRulesByPromotionIds(
	db: Database,
	ids: string[],
): Record<string, number> {
	return countBy(db, "promotion_id", ids);
}

/**
 * A blunt setter with no opinion about legality. Call it ONLY from
 * `core/rules/state.ts` — that module owns which transitions are legal, and a
 * second copy of that rule here would be a second place for them to disagree.
 *
 * `promotionId` is three-valued on purpose: a string links, `null` clears, and
 * `undefined` leaves whatever link the row already had.
 */
export function updateRuleStatus(
	db: Database,
	id: string,
	status: RuleStatus,
	promotionId: string | null | undefined,
	changedAt: string,
): boolean {
	if (promotionId === undefined) {
		return (
			db
				.query(
					"UPDATE rules SET status = ?, status_changed_at = ? WHERE id = ?",
				)
				.run(status, changedAt, id).changes > 0
		);
	}
	return (
		db
			.query(
				"UPDATE rules SET status = ?, promotion_id = ?, status_changed_at = ? WHERE id = ?",
			)
			.run(status, promotionId, changedAt, id).changes > 0
	);
}
