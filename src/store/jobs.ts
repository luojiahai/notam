import type { Database } from "bun:sqlite";
import type { JobKind, JobRow, JobState } from "../shared/types.ts";

type RawJob = Omit<JobRow, "kind" | "state"> & { kind: string; state: string };

function hydrate(raw: RawJob): JobRow {
	return { ...raw, kind: raw.kind as JobKind, state: raw.state as JobState };
}

/** Returns false when the partial unique index rejects a duplicate pending job. */
export function insertJob(
	db: Database,
	job: { id: string; kind: JobKind; target_id: string; created_at: string },
): boolean {
	const result = db
		.query(
			`INSERT INTO jobs (id, kind, target_id, created_at)
			 VALUES ($id, $kind, $target_id, $created_at)
			 ON CONFLICT DO NOTHING`,
		)
		.run({
			$id: job.id,
			$kind: job.kind,
			$target_id: job.target_id,
			$created_at: job.created_at,
		});
	return result.changes > 0;
}

export function selectNextQueued(
	db: Database,
	kinds: JobKind[] | undefined,
): JobRow | null {
	if (kinds && kinds.length === 0) return null;
	const raw = kinds
		? db
				.query<RawJob, string[]>(
					`SELECT * FROM jobs WHERE state = 'queued' AND kind IN (${kinds.map(() => "?").join(",")})
					 ORDER BY created_at, id LIMIT 1`,
				)
				.get(...kinds)
		: db
				.query<RawJob, []>(
					"SELECT * FROM jobs WHERE state = 'queued' ORDER BY created_at, id LIMIT 1",
				)
				.get();
	return raw ? hydrate(raw) : null;
}

export function markRunning(db: Database, id: string, now: string): void {
	db.query(
		"UPDATE jobs SET state = 'running', attempts = attempts + 1, started_at = ?, error = NULL WHERE id = ?",
	).run(now, id);
}

/** Only a `running` job can finish. Returns false if it wasn't (already reset, or unknown id). */
export function markDone(db: Database, id: string, now: string): boolean {
	return (
		db
			.query(
				"UPDATE jobs SET state = 'done', finished_at = ?, error = NULL WHERE id = ? AND state = 'running'",
			)
			.run(now, id).changes > 0
	);
}

/** Only a `running` job can fail. Returns false if it wasn't (already reset, or unknown id). */
export function markFailed(
	db: Database,
	id: string,
	error: string,
	now: string,
): boolean {
	return (
		db
			.query(
				"UPDATE jobs SET state = 'failed', finished_at = ?, error = ? WHERE id = ? AND state = 'running'",
			)
			.run(now, error, id).changes > 0
	);
}

/** Only a `running` job can be requeued. Returns false if it wasn't (already reset, or unknown id). */
export function markQueued(db: Database, id: string): boolean {
	return (
		db
			.query(
				"UPDATE jobs SET state = 'queued', started_at = NULL, finished_at = NULL WHERE id = ? AND state = 'running'",
			)
			.run(id).changes > 0
	);
}

export function resetRunning(db: Database): number {
	return db
		.query(
			"UPDATE jobs SET state = 'queued', started_at = NULL WHERE state = 'running'",
		)
		.run().changes;
}

export function selectJob(db: Database, id: string): JobRow | null {
	const raw = db
		.query<RawJob, [string]>("SELECT * FROM jobs WHERE id = ?")
		.get(id);
	return raw ? hydrate(raw) : null;
}

export function selectJobs(db: Database, state?: JobState): JobRow[] {
	const rows = state
		? db
				.query<RawJob, [string]>(
					"SELECT * FROM jobs WHERE state = ? ORDER BY created_at, id",
				)
				.all(state)
		: db.query<RawJob, []>("SELECT * FROM jobs ORDER BY created_at, id").all();
	return rows.map(hydrate);
}

export function countJobs(db: Database, state: JobState): number {
	const row = db
		.query<{ c: number }, [string]>(
			"SELECT COUNT(*) AS c FROM jobs WHERE state = ?",
		)
		.get(state);
	return row?.c ?? 0;
}
