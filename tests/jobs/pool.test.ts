import { beforeEach, describe, expect, test } from "bun:test";
import type { PoolEvent } from "../../src/jobs/pool.ts";
import { runPool } from "../../src/jobs/pool.ts";
import { JobQueue } from "../../src/jobs/queue.ts";
import { openDatabase } from "../../src/store/db.ts";
import { applyMigrations } from "../../src/store/migrations.ts";

let queue: JobQueue;
beforeEach(() => {
	const db = openDatabase(":memory:");
	applyMigrations(db);
	queue = new JobQueue(db);
});

/** A promise plus its resolver, so a test can hold handlers open on purpose. */
function gate() {
	let open!: () => void;
	const promise = new Promise<void>((resolve) => {
		open = resolve;
	});
	return { promise, open };
}

describe("runPool", () => {
	test("runs every queued job and reports the counts", async () => {
		for (const target of ["e1", "e2", "e3"]) queue.enqueue("analyse", target);
		const seen: string[] = [];
		const result = await runPool({
			queue,
			concurrency: 2,
			handlers: {
				analyse: async (job) => {
					seen.push(job.target_id);
				},
			},
		});
		expect(result).toEqual({
			succeeded: 3,
			failed: 0,
			retried: 0,
			cancelled: 0,
		});
		expect(seen.sort()).toEqual(["e1", "e2", "e3"]);
		expect(queue.count("done")).toBe(3);
	});

	test("never exceeds the concurrency cap", async () => {
		for (let i = 0; i < 10; i++) queue.enqueue("analyse", `e${i}`);
		let inFlight = 0;
		let peak = 0;
		await runPool({
			queue,
			concurrency: 3,
			handlers: {
				analyse: async () => {
					inFlight++;
					peak = Math.max(peak, inFlight);
					await Bun.sleep(5);
					inFlight--;
				},
			},
		});
		expect(peak).toBe(3);
	});

	test("actually runs jobs concurrently rather than one at a time", async () => {
		for (let i = 0; i < 3; i++) queue.enqueue("analyse", `e${i}`);
		const held = gate();
		let started = 0;
		const run = runPool({
			queue,
			concurrency: 3,
			handlers: {
				analyse: async () => {
					started++;
					await held.promise;
				},
			},
		});
		await Bun.sleep(20);
		expect(started).toBe(3);
		held.open();
		await run;
	});

	test("marks a throwing job failed with its error text and keeps going", async () => {
		queue.enqueue("analyse", "bad");
		queue.enqueue("analyse", "good");
		const result = await runPool({
			queue,
			concurrency: 1,
			handlers: {
				analyse: async (job) => {
					if (job.target_id === "bad")
						throw new Error("model produced garbage");
				},
			},
		});
		expect(result.succeeded).toBe(1);
		expect(result.failed).toBe(1);
		const failed = queue.list("failed");
		expect(failed[0]?.target_id).toBe("bad");
		expect(failed[0]?.error).toContain("model produced garbage");
	});

	test("retries up to maxAttempts before failing", async () => {
		queue.enqueue("analyse", "flaky");
		let calls = 0;
		const result = await runPool({
			queue,
			concurrency: 1,
			maxAttempts: 3,
			backoffMs: () => 0,
			handlers: {
				analyse: async () => {
					calls++;
					if (calls < 3) throw new Error("transient");
				},
			},
		});
		expect(calls).toBe(3);
		expect(result).toEqual({
			succeeded: 1,
			failed: 0,
			retried: 2,
			cancelled: 0,
		});
		expect(queue.count("done")).toBe(1);
	});

	test("keeps a retrying job unclaimable for the whole backoff window", async () => {
		const job = queue.enqueue("analyse", "flaky");
		if (!job) throw new Error("expected a job");
		let attempts = 0;
		const run = runPool({
			queue,
			concurrency: 1,
			maxAttempts: 2,
			backoffMs: () => 40,
			handlers: {
				analyse: async () => {
					attempts++;
					if (attempts === 1) throw new Error("transient");
				},
			},
		});

		// Give the first attempt time to fail and enter its backoff sleep, but
		// not long enough for the 40ms backoff to elapse.
		await Bun.sleep(10);
		// A second, independent claim attempt -- as another worker in a bigger
		// pool would make -- must not see the job: it stays `running` for the
		// whole backoff window, not just until requeue is eventually called.
		expect(queue.claim()).toBeNull();
		expect(queue.count("running")).toBe(1);
		expect(queue.count("queued")).toBe(0);

		await run;
		expect(attempts).toBe(2);
		expect(queue.count("done")).toBe(1);
	});

	test("gives up once maxAttempts is exhausted", async () => {
		queue.enqueue("analyse", "doomed");
		const result = await runPool({
			queue,
			concurrency: 1,
			maxAttempts: 2,
			backoffMs: () => 0,
			handlers: {
				analyse: async () => {
					throw new Error("always broken");
				},
			},
		});
		expect(result.failed).toBe(1);
		expect(queue.get(queue.list("failed")[0]?.id ?? "")?.attempts).toBe(2);
	});

	test("never claims a job whose kind has no registered handler, leaving it queued", async () => {
		queue.enqueue("promote", "p1");
		const result = await runPool({ queue, concurrency: 1, handlers: {} });
		expect(result).toEqual({
			succeeded: 0,
			failed: 0,
			retried: 0,
			cancelled: 0,
		});
		expect(queue.count("queued")).toBe(1);
		expect(queue.list("queued")[0]?.target_id).toBe("p1");
	});

	test("a pool with only a sync handler leaves a queued analyse job untouched", async () => {
		queue.enqueue("analyse", "e1");
		queue.enqueue("sync", "r1");
		const result = await runPool({
			queue,
			concurrency: 1,
			handlers: { sync: async () => {} },
		});
		expect(result).toEqual({
			succeeded: 1,
			failed: 0,
			retried: 0,
			cancelled: 0,
		});
		const remaining = queue.list("queued");
		expect(remaining).toHaveLength(1);
		expect(remaining[0]?.kind).toBe("analyse");
		expect(remaining[0]?.target_id).toBe("e1");
	});

	test("emits an event per transition", async () => {
		queue.enqueue("analyse", "e1");
		const events: PoolEvent[] = [];
		await runPool({
			queue,
			concurrency: 1,
			handlers: { analyse: async () => {} },
			onEvent: (event) => events.push(event),
		});
		expect(events.map((e) => e.type)).toEqual(["started", "succeeded"]);
	});

	test("stops claiming new work once the signal aborts", async () => {
		for (let i = 0; i < 6; i++) queue.enqueue("analyse", `e${i}`);
		const controller = new AbortController();
		let handled = 0;
		await runPool({
			queue,
			concurrency: 1,
			signal: controller.signal,
			handlers: {
				analyse: async () => {
					handled++;
					if (handled === 2) controller.abort();
				},
			},
		});
		expect(handled).toBe(2);
		expect(queue.count("queued")).toBe(4);
	});

	test("resumes leftover work after a simulated restart", async () => {
		for (let i = 0; i < 4; i++) queue.enqueue("analyse", `e${i}`);
		const controller = new AbortController();
		await runPool({
			queue,
			concurrency: 1,
			signal: controller.signal,
			handlers: { analyse: async () => controller.abort() },
		});
		expect(queue.count("done")).toBe(1);

		// The "restart": clear anything the dead process left running, drain again.
		queue.resetStale();
		const second = await runPool({
			queue,
			concurrency: 2,
			handlers: { analyse: async () => {} },
		});
		expect(second.succeeded).toBe(3);
		expect(queue.count("done")).toBe(4);
		expect(queue.count("queued")).toBe(0);
	});
});

describe("cancellation", () => {
	test("hands each handler a signal scoped to its own job", async () => {
		queue.enqueue("analyse", "e1");
		queue.enqueue("analyse", "e2");
		const controllers = new Map<string, AbortController>();
		const seen: boolean[] = [];
		await runPool({
			queue,
			concurrency: 2,
			signalFor: (job) => {
				const controller = new AbortController();
				controllers.set(job.target_id, controller);
				return controller.signal;
			},
			handlers: {
				analyse: async (_job, signal) => {
					seen.push(signal.aborted);
				},
			},
		});
		expect(seen).toEqual([false, false]);
		expect(controllers.get("e1")).not.toBe(controllers.get("e2"));
	});

	test("aborting a running job marks it cancelled rather than failed", async () => {
		const job = queue.enqueue("sync", "r1");
		if (!job) throw new Error("expected a job");
		const controller = new AbortController();
		const result = await runPool({
			queue,
			concurrency: 1,
			signalFor: () => controller.signal,
			handlers: {
				sync: async (_job, signal) => {
					controller.abort();
					signal.throwIfAborted();
				},
			},
		});
		expect(result).toEqual({
			succeeded: 0,
			failed: 0,
			retried: 0,
			cancelled: 1,
		});
		expect(queue.get(job.id)?.state).toBe("cancelled");
		expect(queue.count("failed")).toBe(0);
	});

	test("never retries an aborted job, however many attempts remain", async () => {
		queue.enqueue("sync", "r1");
		const controller = new AbortController();
		let calls = 0;
		const result = await runPool({
			queue,
			concurrency: 1,
			maxAttempts: 5,
			backoffMs: () => 0,
			signalFor: () => controller.signal,
			handlers: {
				sync: async (_job, signal) => {
					calls++;
					controller.abort();
					signal.throwIfAborted();
				},
			},
		});
		expect(calls).toBe(1);
		expect(result.retried).toBe(0);
		expect(result.cancelled).toBe(1);
	});

	test("emits a cancelled event carrying the job", async () => {
		queue.enqueue("sync", "r1");
		const controller = new AbortController();
		const events: PoolEvent[] = [];
		await runPool({
			queue,
			concurrency: 1,
			signalFor: () => controller.signal,
			onEvent: (event) => events.push(event),
			handlers: {
				sync: async (_job, signal) => {
					controller.abort();
					signal.throwIfAborted();
				},
			},
		});
		expect(events.map((event) => event.type)).toEqual(["started", "cancelled"]);
		expect(events[1]?.job.target_id).toBe("r1");
	});

	test("cancelling one job leaves the others to finish", async () => {
		queue.enqueue("sync", "doomed");
		queue.enqueue("sync", "fine");
		const controllers = new Map<string, AbortController>();
		const finished: string[] = [];
		const result = await runPool({
			queue,
			concurrency: 2,
			signalFor: (job) => {
				const controller = new AbortController();
				controllers.set(job.target_id, controller);
				return controller.signal;
			},
			handlers: {
				sync: async (job, signal) => {
					if (job.target_id === "doomed") {
						controllers.get("doomed")?.abort();
						signal.throwIfAborted();
					}
					finished.push(job.target_id);
				},
			},
		});
		expect(finished).toEqual(["fine"]);
		expect(result.succeeded).toBe(1);
		expect(result.cancelled).toBe(1);
	});

	test("a throw while the signal is clear is still an ordinary failure", async () => {
		queue.enqueue("sync", "r1");
		const controller = new AbortController();
		const result = await runPool({
			queue,
			concurrency: 1,
			signalFor: () => controller.signal,
			handlers: {
				sync: async () => {
					throw new Error("GitHub returned 500");
				},
			},
		});
		expect(result.failed).toBe(1);
		expect(result.cancelled).toBe(0);
		expect(queue.list("failed")[0]?.error).toContain("GitHub returned 500");
	});

	test("frees the target, so the same repository can be enqueued again at once", async () => {
		queue.enqueue("sync", "r1");
		const controller = new AbortController();
		await runPool({
			queue,
			concurrency: 1,
			signalFor: () => controller.signal,
			handlers: {
				sync: async (_job, signal) => {
					controller.abort();
					signal.throwIfAborted();
				},
			},
		});
		expect(queue.enqueue("sync", "r1")).not.toBeNull();
	});
});
