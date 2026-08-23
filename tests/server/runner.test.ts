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
});
