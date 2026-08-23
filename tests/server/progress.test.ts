import { describe, expect, test } from "bun:test";
import type { SyncEvent } from "../../src/core/sync/index.ts";
import { createProgressPublisher } from "../../src/server/context.ts";
import type { ServerEvent } from "../../src/shared/api.ts";

const INTERVAL = 20;

function collector() {
	const events: ServerEvent[] = [];
	const publisher = createProgressPublisher(
		(event) => events.push(event),
		INTERVAL,
	);
	const syncEvents = () =>
		events.flatMap((event) => (event.type === "sync" ? [event] : []));
	return { events, publisher, syncEvents };
}

const stored = (number: number, created: boolean): SyncEvent => ({
	type: "stored",
	number,
	created,
});

describe("createProgressPublisher", () => {
	test("coalesces a burst of pull requests into one event", async () => {
		const { publisher, syncEvents } = collector();
		for (let number = 0; number < 200; number++) {
			publisher.record("r_1", stored(number, true));
		}
		expect(syncEvents()).toHaveLength(0);

		await Bun.sleep(INTERVAL * 2);
		expect(syncEvents()).toHaveLength(1);
		expect(syncEvents()[0]).toMatchObject({
			repo_id: "r_1",
			phase: "progress",
			scanned: 200,
			created: 200,
			updated: 0,
			skipped: 0,
			error: null,
		});
	});

	test("counts created, updated and skipped separately, and all of them as scanned", async () => {
		const { publisher, syncEvents } = collector();
		publisher.record("r_1", stored(1, true));
		publisher.record("r_1", stored(2, false));
		publisher.record("r_1", { type: "skipped", number: 3, reason: "globs" });
		publisher.record("r_1", {
			type: "missing",
			number: 4,
			reason: "not-found",
		});

		await Bun.sleep(INTERVAL * 2);
		expect(syncEvents()[0]).toMatchObject({
			scanned: 4,
			created: 1,
			updated: 1,
			skipped: 1,
		});
	});

	test("ignores page events, which count a different quantity", async () => {
		const { publisher, syncEvents } = collector();
		publisher.record("r_1", { type: "page", scanned: 50 });

		await Bun.sleep(INTERVAL * 2);
		expect(syncEvents()).toHaveLength(0);
	});

	test("gives each repository its own budget, so neither starves the other", async () => {
		const { publisher, syncEvents } = collector();
		publisher.record("r_1", stored(1, true));
		publisher.record("r_2", stored(2, true));

		await Bun.sleep(INTERVAL * 2);
		const byRepo = syncEvents().map((event) => event.repo_id);
		expect(byRepo.sort()).toEqual(["r_1", "r_2"]);
	});

	test("keeps a running total across intervals rather than resetting", async () => {
		const { publisher, syncEvents } = collector();
		publisher.record("r_1", stored(1, true));
		await Bun.sleep(INTERVAL * 2);
		publisher.record("r_1", stored(2, true));
		await Bun.sleep(INTERVAL * 2);

		expect(syncEvents().map((event) => event.scanned)).toEqual([1, 2]);
	});

	test("publishes nothing more once the job settles", async () => {
		const { publisher, syncEvents } = collector();
		publisher.record("r_1", stored(1, true));
		publisher.settle("r_1");

		await Bun.sleep(INTERVAL * 2);
		expect(syncEvents()).toHaveLength(0);
	});

	test("starts a settled repository's next sync from zero", async () => {
		const { publisher, syncEvents } = collector();
		publisher.record("r_1", stored(1, true));
		await Bun.sleep(INTERVAL * 2);
		publisher.settle("r_1");
		publisher.record("r_1", stored(2, true));
		await Bun.sleep(INTERVAL * 2);

		expect(syncEvents().map((event) => event.scanned)).toEqual([1, 1]);
	});

	test("stop() drops every pending timer", async () => {
		const { publisher, syncEvents } = collector();
		publisher.record("r_1", stored(1, true));
		publisher.record("r_2", stored(2, true));
		publisher.stop();

		await Bun.sleep(INTERVAL * 2);
		expect(syncEvents()).toHaveLength(0);
	});
});
