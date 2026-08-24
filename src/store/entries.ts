import type { Database } from "bun:sqlite";
import { newId } from "../shared/ids.ts";
import type {
	AnalysisState,
	EntryPayload,
	EntryRow,
	NormalisedEntry,
} from "../shared/types.ts";

type RawEntry = {
	id: string;
	repo_id: string;
	kind: string;
	number: number;
	title: string;
	author: string;
	url: string;
	merged_at: string | null;
	updated_at: string;
	payload_json: string;
	changed_paths: string;
	paths_truncated: number;
	analysis_state: string;
	analysed_at: string | null;
	last_error: string | null;
	created_at: string;
};

function hydrate(raw: RawEntry): EntryRow {
	return {
		id: raw.id,
		repo_id: raw.repo_id,
		kind: "pr",
		number: raw.number,
		title: raw.title,
		author: raw.author,
		url: raw.url,
		merged_at: raw.merged_at,
		updated_at: raw.updated_at,
		payload: JSON.parse(raw.payload_json) as EntryPayload,
		changed_paths: JSON.parse(raw.changed_paths) as string[],
		paths_truncated: raw.paths_truncated === 1,
		analysis_state: raw.analysis_state as AnalysisState,
		analysed_at: raw.analysed_at,
		last_error: raw.last_error,
		created_at: raw.created_at,
	};
}

/**
 * Upsert on (repo_id, 'pr', number). Deliberately does NOT touch
 * analysis_state, analysed_at, or last_error: re-syncing an entry refreshes what
 * GitHub owns and leaves what NOTAM owns alone.
 */
export function upsertEntry(
	db: Database,
	repoId: string,
	entry: NormalisedEntry,
	now: Date,
): { id: string; created: boolean } {
	return db.transaction(() => {
		const existing = db
			.query<{ id: string }, [string, number]>(
				"SELECT id FROM entries WHERE repo_id = ? AND kind = 'pr' AND number = ?",
			)
			.get(repoId, entry.number);
		const id = existing?.id ?? newId("e", now.getTime());
		db.query(
			`INSERT INTO entries (id, repo_id, kind, number, title, author, url, merged_at, updated_at, payload_json, changed_paths, paths_truncated, created_at)
			 VALUES ($id, $repo_id, 'pr', $number, $title, $author, $url, $merged_at, $updated_at, $payload_json, $changed_paths, $paths_truncated, $created_at)
			 ON CONFLICT(repo_id, kind, number) DO UPDATE SET
			   title = excluded.title,
			   author = excluded.author,
			   url = excluded.url,
			   merged_at = excluded.merged_at,
			   updated_at = excluded.updated_at,
			   payload_json = excluded.payload_json,
			   changed_paths = excluded.changed_paths,
			   paths_truncated = excluded.paths_truncated`,
		).run({
			$id: id,
			$repo_id: repoId,
			$number: entry.number,
			$title: entry.title,
			$author: entry.author,
			$url: entry.url,
			$merged_at: entry.merged_at,
			$updated_at: entry.updated_at,
			$payload_json: JSON.stringify(entry.payload),
			$changed_paths: JSON.stringify(entry.changed_paths),
			$paths_truncated: entry.paths_truncated ? 1 : 0,
			$created_at: now.toISOString(),
		});
		return { id, created: !existing };
	})();
}

export function getEntry(db: Database, id: string): EntryRow | null {
	const raw = db
		.query<RawEntry, [string]>("SELECT * FROM entries WHERE id = ?")
		.get(id);
	return raw ? hydrate(raw) : null;
}

export function getEntryByNumber(
	db: Database,
	repoId: string,
	number: number,
): EntryRow | null {
	const raw = db
		.query<RawEntry, [string, number]>(
			"SELECT * FROM entries WHERE repo_id = ? AND kind = 'pr' AND number = ?",
		)
		.get(repoId, number);
	return raw ? hydrate(raw) : null;
}

export function listEntries(db: Database, repoId: string): EntryRow[] {
	return db
		.query<RawEntry, [string]>(
			"SELECT * FROM entries WHERE repo_id = ? ORDER BY updated_at DESC, number DESC",
		)
		.all(repoId)
		.map(hydrate);
}

export function countEntries(db: Database, repoId: string): number {
	const row = db
		.query<{ c: number }, [string]>(
			"SELECT COUNT(*) AS c FROM entries WHERE repo_id = ?",
		)
		.get(repoId);
	return row?.c ?? 0;
}

const ANALYSIS_STATES: AnalysisState[] = [
	"unanalysed",
	"queued",
	"running",
	"analysed",
	"failed",
];

/**
 * `analysed_at` and `last_error` are written only when the caller names them.
 * Writing both unconditionally would erase "last analysed at" every time an
 * entry is re-queued, which the entries table is the UI's only source for.
 * The column names come from this file's own allowlist, never from a caller.
 */
export function setAnalysisState(
	db: Database,
	entryId: string,
	state: AnalysisState,
	patch: { analysedAt?: string | null; error?: string | null } = {},
): boolean {
	const assignments = ["analysis_state = $state"];
	const params: Record<string, string | null> = {
		$state: state,
		$id: entryId,
	};
	if ("analysedAt" in patch) {
		assignments.push("analysed_at = $analysed_at");
		params.$analysed_at = patch.analysedAt ?? null;
	}
	if ("error" in patch) {
		assignments.push("last_error = $error");
		params.$error = patch.error ?? null;
	}
	return (
		db
			.query(`UPDATE entries SET ${assignments.join(", ")} WHERE id = $id`)
			.run(params).changes > 0
	);
}

/**
 * Reclaiming a job left `running` by a dead process returns it to the queue,
 * but the entries table is where the UI reads what analysis is doing, so it
 * has to say the same thing. Restricted to entries a queued analyse job
 * actually backs: an entry stranded `running` with nothing behind it is left
 * alone rather than relabelled to a state the jobs table cannot vouch for.
 * Returns how many rows moved.
 */
export function requeueRunningEntries(db: Database): number {
	return db
		.query(
			`UPDATE entries SET analysis_state = 'queued'
			 WHERE analysis_state = 'running'
			   AND id IN (SELECT target_id FROM jobs WHERE kind = 'analyse' AND state = 'queued')`,
		)
		.run().changes;
}

export function listEntriesByState(
	db: Database,
	repoId: string,
	state: AnalysisState,
): EntryRow[] {
	return db
		.query<RawEntry, [string, string]>(
			"SELECT * FROM entries WHERE repo_id = ? AND analysis_state = ? ORDER BY updated_at DESC, number DESC",
		)
		.all(repoId, state)
		.map(hydrate);
}

/** Zero-filled, so the UI's filter chips can render a count for every state. */
export function countEntriesByState(
	db: Database,
	repoId: string,
): Record<AnalysisState, number> {
	const counts = Object.fromEntries(
		ANALYSIS_STATES.map((state) => [state, 0]),
	) as Record<AnalysisState, number>;
	const rows = db
		.query<{ analysis_state: string; c: number }, [string]>(
			"SELECT analysis_state, COUNT(*) AS c FROM entries WHERE repo_id = ? GROUP BY analysis_state",
		)
		.all(repoId);
	for (const row of rows) counts[row.analysis_state as AnalysisState] = row.c;
	return counts;
}

/**
 * Batched sibling of getEntry, so a rules table of N rows resolves its N
 * provenance links in one query instead of N. Unknown ids are simply absent.
 */
export function listEntriesByIds(db: Database, ids: string[]): EntryRow[] {
	if (ids.length === 0) return [];
	const placeholders = ids.map(() => "?").join(",");
	return db
		.query<RawEntry, string[]>(
			`SELECT * FROM entries WHERE id IN (${placeholders}) ORDER BY updated_at DESC, number DESC`,
		)
		.all(...ids)
		.map(hydrate);
}
