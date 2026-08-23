import type { JobKind, JobRow } from "../shared/types.ts";
import type { JobQueue } from "./queue.ts";

export type JobHandler = (job: JobRow) => Promise<void>;

export type PoolEvent =
	| { type: "started"; job: JobRow }
	| { type: "succeeded"; job: JobRow }
	| { type: "retrying"; job: JobRow; error: string }
	| { type: "failed"; job: JobRow; error: string };

export type PoolOptions = {
	queue: JobQueue;
	handlers: Partial<Record<JobKind, JobHandler>>;
	concurrency: number;
	/** Total attempts allowed per job, claim included. Default 1: no retry. */
	maxAttempts?: number;
	/** Backoff before a retry becomes claimable again. Default 500ms * attempts. */
	backoffMs?: (attempts: number) => number;
	signal?: AbortSignal;
	onEvent?: (event: PoolEvent) => void;
};

export type PoolResult = { succeeded: number; failed: number; retried: number };

function describe(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/**
 * Drains the queue with at most `concurrency` handlers in flight, then resolves.
 * Callers enqueue all their work before calling this; a worker that finds an
 * empty queue exits rather than polling, because nothing else adds jobs mid-run.
 */
export async function runPool(options: PoolOptions): Promise<PoolResult> {
	const { queue, handlers, concurrency, signal, onEvent } = options;
	const maxAttempts = options.maxAttempts ?? 1;
	const backoffMs = options.backoffMs ?? ((attempts: number) => 500 * attempts);
	const result: PoolResult = { succeeded: 0, failed: 0, retried: 0 };

	const kinds = Object.keys(handlers) as JobKind[];

	async function worker(): Promise<void> {
		while (!signal?.aborted) {
			const job = queue.claim(kinds);
			if (!job) return;
			onEvent?.({ type: "started", job });

			const handler = handlers[job.kind];
			if (!handler) {
				queue.fail(job.id, `no handler registered for job kind "${job.kind}"`);
				result.failed++;
				onEvent?.({ type: "failed", job, error: "no handler" });
				continue;
			}

			try {
				await handler(job);
				queue.complete(job.id);
				result.succeeded++;
				onEvent?.({ type: "succeeded", job });
			} catch (error) {
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
