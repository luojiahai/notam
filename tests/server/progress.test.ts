import { describe, expect, test } from "bun:test";
import { createProgressPublisher } from "../../src/server/context.ts";
import type { ServerEvent, SyncTotals } from "../../src/shared/api.ts";

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

/** A snapshot of the summary a sync keeps as it walks pull requests. */
function totals(overrides: Partial<SyncTotals> = {}): SyncTotals {
	return { scanned: 0, created: 0, updated: 0, skipped: 0, ...overrides };
}

describe("createProgressPublisher", () => {
	test("coalesces a burst of pull requests into one event", async () => {
		const { publisher, syncEvents } = collector();
		for (let scanned = 1; scanned <= 200; scanned++) {
			publisher.record("r_1", totals({ scanned, created: scanned }));
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

	test("reports the summary's own counts rather than tallying its own", async () => {
		const { publisher, syncEvents } = collector();
		publisher.record(
			"r_1",
			totals({ scanned: 3, created: 1, updated: 1, skipped: 1 }),
		);

		await Bun.sleep(INTERVAL * 2);
		expect(syncEvents()[0]).toMatchObject({
			scanned: 3,
			created: 1,
			updated: 1,
			skipped: 1,
		});
	});

	test("gives each repository its own budget, so neither starves the other", async () => {
		const { publisher, syncEvents } = collector();
		publisher.record("r_1", totals({ scanned: 1 }));
		publisher.record("r_2", totals({ scanned: 1 }));

		await Bun.sleep(INTERVAL * 2);
		const byRepo = syncEvents().map((event) => event.repo_id);
		expect(byRepo.sort()).toEqual(["r_1", "r_2"]);
	});

	test("keeps a running total across intervals rather than resetting", async () => {
		const { publisher, syncEvents } = collector();
		publisher.record("r_1", totals({ scanned: 1 }));
		await Bun.sleep(INTERVAL * 2);
		publisher.record("r_1", totals({ scanned: 2 }));
		await Bun.sleep(INTERVAL * 2);

		expect(syncEvents().map((event) => event.scanned)).toEqual([1, 2]);
	});

	test("publishes nothing more once the job settles", async () => {
		const { publisher, syncEvents } = collector();
		publisher.record("r_1", totals({ scanned: 1 }));
		publisher.settle("r_1");

		await Bun.sleep(INTERVAL * 2);
		expect(syncEvents()).toHaveLength(0);
	});

	test("starts a settled repository's next sync from zero", async () => {
		const { publisher, syncEvents } = collector();
		publisher.record("r_1", totals({ scanned: 1 }));
		await Bun.sleep(INTERVAL * 2);
		publisher.settle("r_1");
		publisher.record("r_1", totals({ scanned: 1 }));
		await Bun.sleep(INTERVAL * 2);

		expect(syncEvents().map((event) => event.scanned)).toEqual([1, 1]);
	});

	test("stop() drops every pending timer", async () => {
		const { publisher, syncEvents } = collector();
		publisher.record("r_1", totals({ scanned: 1 }));
		publisher.record("r_2", totals({ scanned: 1 }));
		publisher.stop();

		await Bun.sleep(INTERVAL * 2);
		expect(syncEvents()).toHaveLength(0);
	});
});
