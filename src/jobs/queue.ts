import type { Database } from "bun:sqlite";
import { newId } from "../shared/ids.ts";
import type { JobKind, JobRow, JobState } from "../shared/types.ts";
import {
	countJobs,
	insertJob,
	type JobStatus,
	markCancelled,
	markDone,
	markFailed,
	markQueued,
	markRunning,
	resetRunning,
	selectJob,
	selectJobStatus,
	selectJobs,
	selectNextQueued,
} from "../store/jobs.ts";

/**
 * The job state machine. Claiming is a transaction so two pool workers on the
 * same database can never take the same row.
 */
export class JobQueue {
	constructor(
		private readonly db: Database,
		private readonly now: () => Date = () => new Date(),
	) {}

	/** Returns null when an equivalent job is already queued or running. */
	enqueue(kind: JobKind, targetId: string): JobRow | null {
		const timestamp = this.now();
		const id = newId("j", timestamp.getTime());
		const inserted = insertJob(this.db, {
			id,
			kind,
			target_id: targetId,
			created_at: timestamp.toISOString(),
		});
		return inserted ? selectJob(this.db, id) : null;
	}

	claim(kinds?: JobKind[]): JobRow | null {
		return this.db.transaction(() => {
			const job = selectNextQueued(this.db, kinds);
			if (!job) return null;
			markRunning(this.db, job.id, this.now().toISOString());
			return selectJob(this.db, job.id);
		})();
	}

	/** Marks a `running` job `done`. Returns false if it was not running (already reset, or unknown id). */
	complete(id: string): boolean {
		return markDone(this.db, id, this.now().toISOString());
	}

	/** Marks a `running` job `failed`. Returns false if it was not running (already reset, or unknown id). */
	fail(id: string, error: string): boolean {
		return markFailed(this.db, id, error, this.now().toISOString());
	}

	/** Puts a `running` job back to `queued`, preserving its attempt count. Returns false if it was not running (already reset, or unknown id). */
	requeue(id: string): boolean {
		return markQueued(this.db, id);
	}

	/**
	 * Marks a pending job `cancelled`, whether it was `queued` or already
	 * `running`. Returns false if it had already settled.
	 *
	 * A cancelled job is neither a success nor a failure: it is the user's own
	 * stop press, and the UI says so rather than showing it back to them as an
	 * error.
	 */
	cancel(id: string): boolean {
		return markCancelled(this.db, id, this.now().toISOString());
	}

	/** Call at startup: anything left `running` belongs to a process that died. */
	resetStale(): number {
		return resetRunning(this.db);
	}

	/** What is pending for this target, and how its last attempt ended. */
	status(kind: JobKind, targetId: string): JobStatus {
		return selectJobStatus(this.db, kind, targetId);
	}

	get(id: string): JobRow | null {
		return selectJob(this.db, id);
	}

	list(state?: JobState): JobRow[] {
		return selectJobs(this.db, state);
	}

	count(state: JobState): number {
		return countJobs(this.db, state);
	}
}
