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
