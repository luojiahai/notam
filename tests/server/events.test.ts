import { describe, expect, test } from "bun:test";
import { EventBus } from "../../src/server/events.ts";
import type { ServerEvent } from "../../src/shared/api.ts";

const beat: ServerEvent = { type: "heartbeat" };

describe("EventBus", () => {
	test("delivers to every subscriber", () => {
		const bus = new EventBus();
		const a: ServerEvent[] = [];
		const b: ServerEvent[] = [];
		bus.subscribe((event) => a.push(event));
		bus.subscribe((event) => b.push(event));
		bus.publish(beat);
		expect(a).toEqual([beat]);
		expect(b).toEqual([beat]);
	});

	test("unsubscribing stops delivery and shrinks the bus", () => {
		const bus = new EventBus();
		const seen: ServerEvent[] = [];
		const off = bus.subscribe((event) => seen.push(event));
		expect(bus.size).toBe(1);
		off();
		expect(bus.size).toBe(0);
		bus.publish(beat);
		expect(seen).toEqual([]);
	});

	test("a throwing subscriber does not stop the others", () => {
		const bus = new EventBus();
		const seen: ServerEvent[] = [];
		bus.subscribe(() => {
			throw new Error("this browser is gone");
		});
		bus.subscribe((event) => seen.push(event));
		expect(() => bus.publish(beat)).not.toThrow();
		expect(seen).toEqual([beat]);
	});

	test("a subscriber may unsubscribe during its own delivery", () => {
		const bus = new EventBus();
		const seen: ServerEvent[] = [];
		const off = bus.subscribe((event) => {
			seen.push(event);
			off();
		});
		bus.subscribe((event) => seen.push(event));
		bus.publish(beat);
		bus.publish(beat);
		expect(seen).toHaveLength(3);
		expect(bus.size).toBe(1);
	});
});
