import { describe, expect, test } from "bun:test";
import { JobQueue } from "../../src/jobs/queue.ts";
import { JobRunner } from "../../src/server/runner.ts";
import { openDatabase } from "../../src/store/db.ts";
import { applyMigrations } from "../../src/store/migrations.ts";

function queueOf(): { db: ReturnType<typeof openDatabase>; queue: JobQueue } {
	const db = openDatabase(":memory:");
	applyMigrations(db);
	return { db, queue: new JobQueue(db) };
}

describe("JobRunner", () => {
	test("kicking an empty queue completes and leaves the runner idle", async () => {
		const { db, queue } = queueOf();
		const runner = new JobRunner({
			queue,
			handlers: { analyse: async () => {} },
			concurrency: 2,
		});
		runner.kick();
		await runner.idle();
		expect(runner.busy).toBe(false);
		db.close();
	});

	test("drains everything queued before the kick", async () => {
		const { db, queue } = queueOf();
		const done: string[] = [];
		for (const target of ["e_1", "e_2", "e_3"])
			queue.enqueue("analyse", target);
		const runner = new JobRunner({
			queue,
			handlers: {
				analyse: async (job) => {
					done.push(job.target_id);
				},
			},
			concurrency: 2,
		});
		runner.kick();
		await runner.idle();
		expect(done.sort()).toEqual(["e_1", "e_2", "e_3"]);
		expect(queue.count("done")).toBe(3);
		db.close();
	});

	test("never runs more handlers at once than its concurrency", async () => {
		const { db, queue } = queueOf();
		let inFlight = 0;
		let peak = 0;
		for (const target of ["a", "b", "c", "d", "e"])
			queue.enqueue("analyse", target);
		const runner = new JobRunner({
			queue,
			handlers: {
				analyse: async () => {
					inFlight++;
					peak = Math.max(peak, inFlight);
					await Bun.sleep(5);
					inFlight--;
				},
			},
			concurrency: 2,
		});
		runner.kick();
		await runner.idle();
		expect(peak).toBe(2);
		db.close();
	});

	test("repeated kicks while busy coalesce into the single running drain", async () => {
		const { db, queue } = queueOf();
		let inFlight = 0;
		let peak = 0;
		for (const target of ["a", "b", "c", "d"]) queue.enqueue("analyse", target);
		const runner = new JobRunner({
			queue,
			handlers: {
				analyse: async () => {
					inFlight++;
					peak = Math.max(peak, inFlight);
					await Bun.sleep(5);
					inFlight--;
				},
			},
			concurrency: 1,
		});
		runner.kick();
		runner.kick();
		runner.kick();
		expect(runner.busy).toBe(true);
		await runner.idle();
		// Three kicks must not have produced three concurrent pools.
		expect(peak).toBe(1);
		expect(queue.count("done")).toBe(4);
		db.close();
	});

	test("a kick after a drain finishes starts a fresh one", async () => {
		const { db, queue } = queueOf();
		const done: string[] = [];
		const runner = new JobRunner({
			queue,
			handlers: {
				analyse: async (job) => {
					done.push(job.target_id);
				},
			},
			concurrency: 1,
		});
		queue.enqueue("analyse", "first");
		runner.kick();
		await runner.idle();
		queue.enqueue("analyse", "second");
		runner.kick();
		await runner.idle();
		expect(done).toEqual(["first", "second"]);
		db.close();
	});

	test("a throwing handler fails its job and the drain still finishes", async () => {
		const { db, queue } = queueOf();
		const failures: string[] = [];
		queue.enqueue("analyse", "bad");
		queue.enqueue("analyse", "good");
		const runner = new JobRunner({
			queue,
			handlers: {
				analyse: async (job) => {
					if (job.target_id === "bad") throw new Error("boom");
				},
			},
			concurrency: 1,
			onEvent: (event) => {
				if (event.type === "failed") failures.push(event.error);
			},
		});
		runner.kick();
		await runner.idle();
		expect(failures).toEqual(["boom"]);
		expect(queue.count("failed")).toBe(1);
		expect(queue.count("done")).toBe(1);
		db.close();
	});

	test("stop() prevents any further work", async () => {
		const { db, queue } = queueOf();
		const done: string[] = [];
		queue.enqueue("analyse", "e_1");
		const runner = new JobRunner({
			queue,
			handlers: {
				analyse: async (job) => {
					done.push(job.target_id);
				},
			},
			concurrency: 1,
		});
		runner.stop();
		runner.kick();
		await runner.idle();
		expect(done).toEqual([]);
		expect(runner.busy).toBe(false);
		db.close();
	});

	test("a kick() reentrant from onEvent never starts a second concurrent pool", async () => {
		const { db, queue } = queueOf();
		let inFlight = 0;
		let peak = 0;
		const done: string[] = [];
		for (const target of ["a", "b", "c"]) queue.enqueue("analyse", target);
		const runner = new JobRunner({
			queue,
			handlers: {
				analyse: async (job) => {
					inFlight++;
					peak = Math.max(peak, inFlight);
					await Bun.sleep(5);
					inFlight--;
					done.push(job.target_id);
				},
			},
			concurrency: 2,
			onEvent: (event) => {
				// A plausible Task 4 wiring: react to a job starting by kicking
				// again. This fires synchronously, before the first `await` in
				// `runPool`'s workers, and must coalesce into the same drain
				// rather than spinning up a second concurrent pool.
				if (event.type === "started") runner.kick();
			},
		});
		runner.kick();
		await runner.idle();
		expect(peak).toBeLessThanOrEqual(2);
		expect(done.sort()).toEqual(["a", "b", "c"]);
		expect(queue.count("done")).toBe(3);
		db.close();
	});

	test("a throwing onError does not produce an unhandled rejection", async () => {
		const { db, queue } = queueOf();
		queue.enqueue("analyse", "e_1");
		const runner = new JobRunner({
			queue,
			handlers: { analyse: async () => {} },
			concurrency: 1,
			onEvent: () => {
				throw new Error("onEvent boom");
			},
			onError: () => {
				throw new Error("onError boom");
			},
		});
		runner.kick();
		await runner.idle();
		expect(runner.busy).toBe(false);
		db.close();
	});
});

describe("JobRunner cancellation", () => {
	/** A promise plus its resolver, so a test can hold a handler open on purpose. */
	function gate() {
		let open!: () => void;
		const promise = new Promise<void>((resolve) => {
			open = resolve;
		});
		return { promise, open };
	}

	test("cancels a job that is already running", async () => {
		const { db, queue } = queueOf();
		const job = queue.enqueue("sync", "r1");
		if (!job) throw new Error("expected a job");
		const running = gate();
		const runner = new JobRunner({
			queue,
			concurrency: 1,
			handlers: {
				sync: async (_job, signal) => {
					running.open();
					await new Promise((_resolve, reject) => {
						signal.addEventListener("abort", () => reject(signal.reason));
					});
				},
			},
		});
		runner.kick();
		await running.promise;

		expect(runner.cancel(job.id)).toBe(true);
		await runner.idle();
		expect(queue.get(job.id)?.state).toBe("cancelled");
		db.close();
	});

	test("cancels a job still queued behind another, without ever claiming it", async () => {
		const { db, queue } = queueOf();
		queue.enqueue("sync", "first");
		// Ids tie-break on random characters within a millisecond, so the two
		// jobs need distinct `created_at` values for the claim order to be the
		// enqueue order.
		await Bun.sleep(2);
		const second = queue.enqueue("sync", "second");
		if (!second) throw new Error("expected a job");
		const held = gate();
		const claimed: string[] = [];
		const runner = new JobRunner({
			queue,
			concurrency: 1,
			handlers: {
				sync: async (job) => {
					claimed.push(job.target_id);
					await held.promise;
				},
			},
		});
		runner.kick();
		await Bun.sleep(10);

		expect(runner.cancel(second.id)).toBe(true);
		held.open();
		await runner.idle();
		expect(claimed).toEqual(["first"]);
		expect(queue.get(second.id)?.state).toBe("cancelled");
		db.close();
	});

	test("refuses to cancel a job that already settled", async () => {
		const { db, queue } = queueOf();
		const job = queue.enqueue("sync", "r1");
		if (!job) throw new Error("expected a job");
		const runner = new JobRunner({
			queue,
			concurrency: 1,
			handlers: { sync: async () => {} },
		});
		runner.kick();
		await runner.idle();
		expect(runner.cancel(job.id)).toBe(false);
		expect(queue.get(job.id)?.state).toBe("done");
		db.close();
	});

	test("cancelling one repository leaves another mid-sync alone", async () => {
		const { db, queue } = queueOf();
		const doomed = queue.enqueue("sync", "doomed");
		const other = queue.enqueue("sync", "other");
		if (!doomed || !other) throw new Error("expected jobs");
		const bothRunning = gate();
		const release = gate();
		let started = 0;
		const runner = new JobRunner({
			queue,
			concurrency: 2,
			handlers: {
				sync: async (job, signal) => {
					if (++started === 2) bothRunning.open();
					if (job.target_id === "other") {
						await release.promise;
						return;
					}
					await new Promise((_resolve, reject) => {
						signal.addEventListener("abort", () => reject(signal.reason));
					});
				},
			},
		});
		runner.kick();
		await bothRunning.promise;

		runner.cancel(doomed.id);
		release.open();
		await runner.idle();
		expect(queue.get(doomed.id)?.state).toBe("cancelled");
		expect(queue.get(other.id)?.state).toBe("done");
		db.close();
	});

	/**
	 * A shutdown is not an outcome. The job returns to the queue and the next
	 * start runs it, so nothing is lost and the user is never told a sync was
	 * stopped when nobody stopped it.
	 */
	test("stop() aborts a sync in flight and returns it to the queue", async () => {
		const { db, queue } = queueOf();
		const job = queue.enqueue("sync", "r1");
		if (!job) throw new Error("expected a job");
		const running = gate();
		const runner = new JobRunner({
			queue,
			concurrency: 1,
			handlers: {
				sync: async (_job, signal) => {
					running.open();
					await new Promise((_resolve, reject) => {
						signal.addEventListener("abort", () => reject(signal.reason));
					});
				},
			},
		});
		runner.kick();
		await running.promise;

		runner.stop();
		await runner.idle();
		const after = queue.get(job.id);
		expect(after?.state).toBe("queued");
		expect(after?.attempts).toBe(1);
		db.close();
	});
});

describe("shutdown versus cancellation", () => {
	function gate() {
		let open!: () => void;
		const promise = new Promise<void>((resolve) => {
			open = resolve;
		});
		return { promise, open };
	}

	/**
	 * The two aborts look identical to a handler and must not look identical to
	 * the queue: one is work the user refused, the other is work not yet done.
	 */
	test("a cancelled job settles while a shut-down one stays claimable", async () => {
		const { db, queue } = queueOf();
		const cancelled = queue.enqueue("sync", "cancelled");
		await Bun.sleep(2);
		const stopped = queue.enqueue("sync", "stopped");
		if (!cancelled || !stopped) throw new Error("expected jobs");
		const bothRunning = gate();
		let started = 0;
		const runner = new JobRunner({
			queue,
			concurrency: 2,
			handlers: {
				sync: async (_job, signal) => {
					if (++started === 2) bothRunning.open();
					await new Promise((_resolve, reject) => {
						signal.addEventListener("abort", () => reject(signal.reason));
					});
				},
			},
		});
		runner.kick();
		await bothRunning.promise;

		runner.cancel(cancelled.id);
		runner.stop();
		await runner.idle();

		expect(queue.get(cancelled.id)?.state).toBe("cancelled");
		expect(queue.get(stopped.id)?.state).toBe("queued");
		db.close();
	});
});
