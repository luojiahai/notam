import type { JobKind, JobRow } from "../shared/types.ts";
import type { JobQueue } from "./queue.ts";

/**
 * The signal aborts when this one job is cancelled, or when the whole runner
 * is stopping. A handler that reaches the network is expected to honour it;
 * one that does not simply runs to completion and its result is discarded.
 */
export type JobHandler = (job: JobRow, signal: AbortSignal) => Promise<void>;

export type PoolEvent =
	| { type: "started"; job: JobRow }
	| { type: "succeeded"; job: JobRow }
	| { type: "retrying"; job: JobRow; error: string }
	| { type: "failed"; job: JobRow; error: string }
	| { type: "cancelled"; job: JobRow }
	| { type: "interrupted"; job: JobRow };

export type PoolOptions = {
	queue: JobQueue;
	handlers: Partial<Record<JobKind, JobHandler>>;
	concurrency: number;
	/** Total attempts allowed per job, claim included. Default 1: no retry. */
	maxAttempts?: number;
	/** Backoff before a retry becomes claimable again. Default 500ms * attempts. */
	backoffMs?: (attempts: number) => number;
	/** Stops the pool claiming further work. Does not reach a handler already in flight. */
	signal?: AbortSignal;
	/**
	 * The per-job signal handed to the handler. A caller that wants to cancel
	 * one job in flight keeps the controller and aborts it. Defaults to
	 * `signal`, so a caller with a single controller gets both behaviours
	 * without wiring the same signal twice.
	 */
	signalFor?: (job: JobRow) => AbortSignal;
	onEvent?: (event: PoolEvent) => void;
};

export type PoolResult = {
	succeeded: number;
	failed: number;
	retried: number;
	cancelled: number;
	interrupted: number;
};

/**
 * The abort reason that marks a stop of the whole pool rather than of one job.
 *
 * A job abandoned because the process is going down has not been refused: it
 * goes back to the queue and the next start runs it. Only a job someone
 * deliberately cancelled is recorded as cancelled, so the UI never reports a
 * shutdown as a stop the user pressed.
 */
export const POOL_STOPPED = "pool-stopped";

function describe(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/**
 * Drains the queue with at most `concurrency` handlers in flight, then resolves.
 * Callers enqueue all their work before calling this; a worker that finds an
 * empty queue exits rather than polling, because nothing else adds jobs mid-run.
 */
export async function runPool(options: PoolOptions): Promise<PoolResult> {
	const { queue, handlers, concurrency, signal, signalFor, onEvent } = options;
	const maxAttempts = options.maxAttempts ?? 1;
	const backoffMs = options.backoffMs ?? ((attempts: number) => 500 * attempts);
	const result: PoolResult = {
		succeeded: 0,
		failed: 0,
		retried: 0,
		cancelled: 0,
		interrupted: 0,
	};
	/** Aborts nothing on its own: the default when no caller supplies a signal. */
	const never = new AbortController().signal;

	const kinds = Object.keys(handlers) as JobKind[];

	async function worker(): Promise<void> {
		while (!signal?.aborted) {
			const job = queue.claim(kinds);
			if (!job) return;
			// Resolved before the job is announced, and before any `await`, so
			// there is no moment at which an observer can see a claimed job
			// whose signal does not exist yet. A caller that cancelled in that
			// window would take the not-yet-claimed path and dequeue a row
			// whose handler is about to run regardless.
			const jobSignal = signalFor?.(job) ?? signal ?? never;
			onEvent?.({ type: "started", job });

			const handler = handlers[job.kind];
			if (!handler) {
				queue.fail(job.id, `no handler registered for job kind "${job.kind}"`);
				result.failed++;
				onEvent?.({ type: "failed", job, error: "no handler" });
				continue;
			}

			try {
				await handler(job, jobSignal);
				queue.complete(job.id);
				result.succeeded++;
				onEvent?.({ type: "succeeded", job });
			} catch (error) {
				// Checked before the retry branch, and deliberately so: an
				// aborted job that fell into a retry would be resurrected by
				// the very mechanism meant to survive transient faults, and the
				// user's stop press would look like it did nothing.
				if (jobSignal.aborted) {
					if (jobSignal.reason === POOL_STOPPED) {
						queue.requeue(job.id);
						result.interrupted++;
						onEvent?.({ type: "interrupted", job });
					} else {
						queue.cancel(job.id);
						result.cancelled++;
						onEvent?.({ type: "cancelled", job });
					}
					continue;
				}
				const message = describe(error);
				if (job.attempts < maxAttempts) {
					result.retried++;
					onEvent?.({ type: "retrying", job, error: message });
					// The job stays `running` (and thus unclaimable, and still
					// deduped by the partial unique index) for the whole backoff,
					// exactly as the `backoffMs` doc comment promises. Requeueing
					// first would make it claimable immediately, defeating the
					// backoff for every worker but the one that just failed it.
					await Bun.sleep(backoffMs(job.attempts));
					queue.requeue(job.id);
				} else {
					queue.fail(job.id, message);
					result.failed++;
					onEvent?.({ type: "failed", job, error: message });
				}
			}
		}
	}

	await Promise.all(
		Array.from({ length: Math.max(1, concurrency) }, () => worker()),
	);
	return result;
}
