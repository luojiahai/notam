import {
	type JobHandler,
	POOL_STOPPED,
	type PoolEvent,
	runPool,
} from "../jobs/pool.ts";
import type { JobQueue } from "../jobs/queue.ts";
import type { JobKind, JobRow } from "../shared/types.ts";

export type JobRunnerOptions = {
	queue: JobQueue;
	handlers: Partial<Record<JobKind, JobHandler>>;
	concurrency: number;
	onEvent?: (event: PoolEvent) => void;
	/** A drain must never reject into an unhandled rejection; this is where it goes instead. */
	onError?: (error: unknown) => void;
};

/**
 * A long-lived wrapper around `runPool`.
 *
 * `runPool` is a one-shot: its workers exit as soon as the queue is empty,
 * which is exactly right for `notam sync` and exactly wrong for a server, where
 * work arrives whenever a button is pressed. `kick()` closes that gap without
 * polling: if no drain is running it starts one, and if one is already running
 * it sets a flag so the drain loops once more when the pool returns. That
 * second pass is what covers the race where a job is enqueued in the same
 * moment the last worker is exiting.
 *
 * Two runners exist per server, one per job kind, so a long repository sync can
 * never occupy the analysis concurrency the user configured.
 */
export class JobRunner {
	private draining: Promise<void> | null = null;
	private again = false;
	private stopped = false;
	private readonly controller = new AbortController();
	/**
	 * One controller per job in flight, so cancelling one repository's sync
	 * cannot touch another's. Entries appear when a job is claimed and are
	 * removed when it settles; a retry keeps its entry, because the same job id
	 * is about to be claimed again.
	 */
	private readonly controllers = new Map<string, AbortController>();

	constructor(private readonly options: JobRunnerOptions) {}

	kick(): void {
		if (this.stopped) return;
		if (this.draining) {
			this.again = true;
			return;
		}
		// `drain()` (and the `runPool()` workers it awaits) run synchronously up
		// to their first `await`, which can fire an `onEvent` callback before
		// this assignment would otherwise complete. Deferring the call itself to
		// a microtask means `this.draining` is already non-null by the time any
		// reentrant `kick()` — e.g. from inside that `onEvent` callback — can
		// observe it, so a reentrant call always takes the coalescing branch
		// above instead of starting a second, concurrent pool.
		this.draining = Promise.resolve().then(() => this.drain());
	}

	get busy(): boolean {
		return this.draining !== null;
	}

	/**
	 * Cancels one job, running or merely queued. Returns false when there was
	 * nothing to cancel, which is the honest answer for a job that already
	 * settled — never an error.
	 *
	 * A running job is aborted through its own signal and the pool decides its
	 * outcome, so a job's fate is written in exactly one place. A job that has
	 * not been claimed has no controller yet, so it is cancelled at the queue
	 * instead and will never be claimed at all.
	 */
	cancel(jobId: string): boolean {
		const controller = this.controllers.get(jobId);
		if (controller) {
			controller.abort();
			return true;
		}
		return this.options.queue.cancel(jobId);
	}

	/**
	 * Resolves once no drain is in flight. Tests await this; the server never
	 * does — a request that waited for the queue to empty would be the blocking
	 * behaviour this class exists to avoid.
	 */
	async idle(): Promise<void> {
		while (this.draining) await this.draining;
	}

	stop(): void {
		this.stopped = true;
		// Reasoned, so a job abandoned to a shutdown returns to the queue for
		// the next start rather than being recorded as one the user stopped.
		this.controller.abort(POOL_STOPPED);
	}

	/**
	 * Cancels whatever this target has pending, if anything. The pending index
	 * makes that job single-valued, so a caller holding only a repository id
	 * never has to guess which job it means.
	 */
	cancelPending(kind: JobKind, targetId: string): boolean {
		const { pending } = this.options.queue.status(kind, targetId);
		return pending ? this.cancel(pending.id) : false;
	}

	/**
	 * Composed with the runner-wide controller, so `stop()` reaches a handler
	 * that is already mid-request instead of leaving the process waiting on a
	 * network call it no longer wants.
	 */
	private signalFor(job: JobRow): AbortSignal {
		const controller = new AbortController();
		this.controllers.set(job.id, controller);
		return AbortSignal.any([this.controller.signal, controller.signal]);
	}

	/** `retrying` is not terminal: the same job id is about to be claimed again. */
	private onEvent(event: PoolEvent): void {
		if (event.type !== "started" && event.type !== "retrying") {
			this.controllers.delete(event.job.id);
		}
		this.options.onEvent?.(event);
	}

	private async drain(): Promise<void> {
		try {
			do {
				this.again = false;
				await runPool({
					queue: this.options.queue,
					handlers: this.options.handlers,
					concurrency: this.options.concurrency,
					signal: this.controller.signal,
					signalFor: (job) => this.signalFor(job),
					onEvent: (event) => this.onEvent(event),
				});
			} while (this.again && !this.stopped);
		} catch (error) {
			try {
				this.options.onError?.(error);
			} catch {
				// A drain must never reject into an unhandled rejection, even when
				// the caller's own `onError` throws.
			}
		} finally {
			this.draining = null;
		}
	}
}
