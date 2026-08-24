import { describe, expect, test } from "bun:test";
import { EventBus } from "../../src/server/events.ts";
import { sseResponse } from "../../src/server/sse.ts";
import { testContext } from "./helpers.ts";

/** Reads exactly one `data:` frame off the stream. */
async function readFrame(
	reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<string> {
	const { value, done } = await reader.read();
	if (done || !value) throw new Error("the stream ended early");
	return new TextDecoder().decode(value);
}

describe("sseResponse", () => {
	test("sets the event-stream headers and greets with hello", async () => {
		const bus = new EventBus();
		const controller = new AbortController();
		const response = sseResponse(bus, {
			version: "test",
			heartbeatMs: 60_000,
			signal: controller.signal,
		});
		expect(response.headers.get("content-type")).toBe("text/event-stream");
		expect(response.headers.get("cache-control")).toBe("no-cache");
		const reader = (response.body as ReadableStream<Uint8Array>).getReader();
		expect(await readFrame(reader)).toBe(
			'data: {"type":"hello","version":"test"}\n\n',
		);
		controller.abort();
		bus.publish({ type: "heartbeat" });
		expect(bus.size).toBe(0);
	});

	test("forwards published events as data frames", async () => {
		const bus = new EventBus();
		const controller = new AbortController();
		const response = sseResponse(bus, {
			version: "test",
			heartbeatMs: 60_000,
			signal: controller.signal,
		});
		const reader = (response.body as ReadableStream<Uint8Array>).getReader();
		await readFrame(reader);
		bus.publish({ type: "rules", repo_id: "r_1" });
		expect(await readFrame(reader)).toBe(
			'data: {"type":"rules","repo_id":"r_1"}\n\n',
		);
		controller.abort();
	});

	test("aborting unsubscribes so a closed tab stops receiving", async () => {
		const bus = new EventBus();
		const controller = new AbortController();
		const response = sseResponse(bus, {
			version: "test",
			heartbeatMs: 60_000,
			signal: controller.signal,
		});
		const reader = (response.body as ReadableStream<Uint8Array>).getReader();
		await readFrame(reader);
		expect(bus.size).toBe(1);
		controller.abort();
		expect(bus.size).toBe(0);
	});
});

describe("GET /api/events", () => {
	test("streams the hello frame and a live event", async () => {
		const harness = testContext();
		const controller = new AbortController();
		const response = await harness.app.request("/api/events", {
			signal: controller.signal,
		});
		expect(response.headers.get("content-type")).toBe("text/event-stream");
		const reader = (response.body as ReadableStream<Uint8Array>).getReader();
		expect(await readFrame(reader)).toContain('"type":"hello"');
		harness.ctx.bus.publish({ type: "rules", repo_id: harness.repoId });
		expect(await readFrame(reader)).toContain('"type":"rules"');
		controller.abort();
		harness.close();
	});
});
