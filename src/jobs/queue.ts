import type { Database } from "bun:sqlite";
import { newId } from "../shared/ids.ts";
import type { JobKind, JobRow, JobState } from "../shared/types.ts";
import {
	countJobs,
	insertJob,
	markDone,
	markFailed,
	markQueued,
	markRunning,
	resetRunning,
	selectJob,
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

	complete(id: string): void {
		markDone(this.db, id, this.now().toISOString());
	}

	fail(id: string, error: string): void {
		markFailed(this.db, id, error, this.now().toISOString());
	}

	requeue(id: string): void {
		markQueued(this.db, id);
	}

	/** Call at startup: anything left `running` belongs to a process that died. */
	resetStale(): number {
		return resetRunning(this.db);
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
