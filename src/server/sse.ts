import type { ServerEvent } from "../shared/api.ts";
import type { EventBus } from "./events.ts";

export type SseOptions = {
	version: string;
	/** A comment-free keep-alive so proxies and idle sockets do not drop the stream. */
	heartbeatMs?: number;
	/** The request's own abort signal. Closing the tab must free the subscription. */
	signal?: AbortSignal;
};

const DEFAULT_HEARTBEAT_MS = 15_000;

/**
 * Hand-rolled rather than built on a streaming helper, for one reason: this
 * shape is testable with nothing but `getReader()`, so the fan-out, the
 * greeting, and — the part that actually bites — the unsubscribe-on-disconnect
 * are all covered by ordinary unit tests.
 */
export function sseResponse(bus: EventBus, options: SseOptions): Response {
	const encoder = new TextEncoder();
	let unsubscribe: () => void = () => {};
	let timer: ReturnType<typeof setInterval> | undefined;

	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			const cleanup = () => {
				unsubscribe();
				if (timer !== undefined) clearInterval(timer);
			};

			const send = (event: ServerEvent) => {
				try {
					controller.enqueue(
						encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
					);
				} catch {
					// The consumer is gone. Detach rather than throwing into the
					// worker that published this.
					cleanup();
				}
			};

			unsubscribe = bus.subscribe(send);
			send({ type: "hello", version: options.version });

			timer = setInterval(
				() => send({ type: "heartbeat" }),
				options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS,
			);
			// Without this a single open tab would keep `bun test` — and a
			// shutting-down server — alive forever.
			timer.unref?.();

			options.signal?.addEventListener("abort", () => {
				cleanup();
				try {
					controller.close();
				} catch {
					// Already closed; nothing to do.
				}
			});
		},
		cancel() {
			unsubscribe();
			if (timer !== undefined) clearInterval(timer);
		},
	});

	return new Response(stream, {
		headers: {
			"content-type": "text/event-stream",
			"cache-control": "no-cache",
			connection: "keep-alive",
			// Bun does not buffer, but a reverse proxy in front of a future
			// deployment would; saying so costs nothing.
			"x-accel-buffering": "no",
		},
	});
}
