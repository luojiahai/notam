import { beforeEach, describe, expect, test } from "bun:test";
import { JobQueue } from "../../src/jobs/queue.ts";
import { openDatabase } from "../../src/store/db.ts";
import { applyMigrations } from "../../src/store/migrations.ts";

let queue: JobQueue;
let clock: Date;

beforeEach(() => {
	const db = openDatabase(":memory:");
	applyMigrations(db);
	clock = new Date("2026-08-23T09:00:00.000Z");
	queue = new JobQueue(db, () => clock);
});

function tick(seconds: number) {
	clock = new Date(clock.getTime() + seconds * 1000);
}

describe("enqueue", () => {
	test("creates a queued job with zero attempts", () => {
		const job = queue.enqueue("sync", "r1");
		expect(job?.id).toStartWith("j_");
		expect(job?.state).toBe("queued");
		expect(job?.attempts).toBe(0);
		expect(job?.created_at).toBe("2026-08-23T09:00:00.000Z");
	});

	test("refuses a duplicate while one is still pending", () => {
		queue.enqueue("sync", "r1");
		expect(queue.enqueue("sync", "r1")).toBeNull();
		expect(queue.count("queued")).toBe(1);
	});

	test("allows the same target again once the previous job finished", () => {
		const first = queue.enqueue("sync", "r1");
		if (!first) throw new Error("expected a job");
		queue.claim();
		queue.complete(first.id);
		expect(queue.enqueue("sync", "r1")).not.toBeNull();
	});

	test("treats different kinds against the same target as different jobs", () => {
		expect(queue.enqueue("sync", "r1")).not.toBeNull();
		expect(queue.enqueue("analyse", "r1")).not.toBeNull();
	});
});

describe("claim", () => {
	test("returns jobs oldest-first and marks them running", () => {
		queue.enqueue("sync", "r1");
		tick(1);
		queue.enqueue("sync", "r2");
		expect(queue.claim()?.target_id).toBe("r1");
		expect(queue.claim()?.target_id).toBe("r2");
	});

	test("increments attempts and stamps started_at", () => {
		queue.enqueue("sync", "r1");
		tick(5);
		const job = queue.claim();
		expect(job?.state).toBe("running");
		expect(job?.attempts).toBe(1);
		expect(job?.started_at).toBe("2026-08-23T09:00:05.000Z");
	});

	test("never returns the same job twice", () => {
		queue.enqueue("sync", "r1");
		expect(queue.claim()).not.toBeNull();
		expect(queue.claim()).toBeNull();
	});

	test("returns null on an empty queue", () => {
		expect(queue.claim()).toBeNull();
	});

	test("honours a kind filter", () => {
		queue.enqueue("analyse", "e1");
		expect(queue.claim(["sync"])).toBeNull();
		expect(queue.claim(["analyse"])?.target_id).toBe("e1");
	});
});

describe("complete and fail", () => {
	test("complete stamps finished_at and clears the error", () => {
		const job = queue.enqueue("sync", "r1");
		if (!job) throw new Error("expected a job");
		queue.claim();
		tick(10);
		expect(queue.complete(job.id)).toBe(true);
		const done = queue.get(job.id);
		expect(done?.state).toBe("done");
		expect(done?.finished_at).toBe("2026-08-23T09:00:10.000Z");
		expect(done?.error).toBeNull();
	});

	test("fail retains the error text for display", () => {
		const job = queue.enqueue("sync", "r1");
		if (!job) throw new Error("expected a job");
		queue.claim();
		expect(queue.fail(job.id, "GitHub returned 401 Bad credentials")).toBe(
			true,
		);
		const failed = queue.get(job.id);
		expect(failed?.state).toBe("failed");
		expect(failed?.error).toBe("GitHub returned 401 Bad credentials");
		expect(failed?.attempts).toBe(1);
	});

	test("requeue puts a job back without losing its attempt count", () => {
		const job = queue.enqueue("sync", "r1");
		if (!job) throw new Error("expected a job");
		queue.claim();
		expect(queue.requeue(job.id)).toBe(true);
		const back = queue.get(job.id);
		expect(back?.state).toBe("queued");
		expect(back?.attempts).toBe(1);
		expect(back?.started_at).toBeNull();
	});

	test("complete on a queued (never-claimed) job returns false and leaves it queued", () => {
		const job = queue.enqueue("sync", "r1");
		if (!job) throw new Error("expected a job");
		expect(queue.complete(job.id)).toBe(false);
		expect(queue.get(job.id)?.state).toBe("queued");
	});

	test("complete on a nonexistent id returns false and creates nothing", () => {
		expect(queue.complete("j_doesnotexist")).toBe(false);
		expect(queue.get("j_doesnotexist")).toBeNull();
	});

	test("fail on a nonexistent id returns false and creates nothing", () => {
		expect(queue.fail("j_doesnotexist", "boom")).toBe(false);
		expect(queue.get("j_doesnotexist")).toBeNull();
	});

	test("complete after resetStale already reset the job to queued is a no-op (lost-update guard)", () => {
		const job = queue.enqueue("sync", "r1");
		if (!job) throw new Error("expected a job");
		queue.claim();
		// Simulate a crash-recovery reset racing a worker that is still trying
		// to report success for the job it thinks it owns.
		queue.resetStale();
		expect(queue.get(job.id)?.state).toBe("queued");
		expect(queue.complete(job.id)).toBe(false);
		const after = queue.get(job.id);
		expect(after?.state).toBe("queued");
		expect(after?.finished_at).toBeNull();
	});
});

describe("resetStale", () => {
	test("returns jobs left running by a crash to the queue", () => {
		queue.enqueue("sync", "r1");
		queue.enqueue("sync", "r2");
		queue.claim();
		queue.claim();
		expect(queue.count("running")).toBe(2);
		expect(queue.resetStale()).toBe(2);
		expect(queue.count("queued")).toBe(2);
		expect(queue.count("running")).toBe(0);
	});

	test("preserves attempts so a poison job cannot retry forever", () => {
		const job = queue.enqueue("sync", "r1");
		if (!job) throw new Error("expected a job");
		queue.claim();
		queue.resetStale();
		expect(queue.get(job.id)?.attempts).toBe(1);
	});

	test("leaves done and failed jobs alone", () => {
		const done = queue.enqueue("sync", "r1");
		const failed = queue.enqueue("sync", "r2");
		if (!done || !failed) throw new Error("expected jobs");
		queue.claim();
		queue.claim();
		queue.complete(done.id);
		queue.fail(failed.id, "boom");
		expect(queue.resetStale()).toBe(0);
		expect(queue.get(done.id)?.state).toBe("done");
		expect(queue.get(failed.id)?.state).toBe("failed");
	});
});

describe("persistence", () => {
	test("a fresh JobQueue over the same database sees the pending work", () => {
		const db = openDatabase(":memory:");
		applyMigrations(db);
		const first = new JobQueue(db, () => clock);
		first.enqueue("analyse", "e1");
		first.enqueue("analyse", "e2");
		first.claim();

		// Simulate a restart: a new queue object, the same database file.
		const second = new JobQueue(db, () => clock);
		expect(second.resetStale()).toBe(1);
		expect(second.count("queued")).toBe(2);
	});
});
