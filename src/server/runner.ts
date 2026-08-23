import { type JobHandler, type PoolEvent, runPool } from "../jobs/pool.ts";
import type { JobQueue } from "../jobs/queue.ts";
import type { JobKind } from "../shared/types.ts";

export type JobRunnerOptions = {
	queue: JobQueue;
	handlers: Partial<Record<JobKind, JobHandler>>;
	concurrency: number;
	onEvent?: (event: PoolEvent) => void;
	/** A drain must never reject into an unhandled rejection; this is where it goes instead. */
	onError?: (error: unknown) => void;
};

/**
 * A long-lived wrapper around plan 1's `runPool`.
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

	constructor(private readonly options: JobRunnerOptions) {}

	kick(): void {
		if (this.stopped) return;
		if (this.draining) {
			this.again = true;
			return;
		}
		this.draining = this.drain();
	}

	get busy(): boolean {
		return this.draining !== null;
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
		this.controller.abort();
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
					onEvent: this.options.onEvent,
				});
			} while (this.again && !this.stopped);
		} catch (error) {
			this.options.onError?.(error);
		} finally {
			this.draining = null;
		}
	}
}
