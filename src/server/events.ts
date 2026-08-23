import type { ServerEvent } from "../shared/api.ts";

export type Subscriber = (event: ServerEvent) => void;

/**
 * Fan-out from the workers to every open SSE connection.
 *
 * Deliberately synchronous and fire-and-forget. A worker publishing progress
 * must never be slowed down, and must never fail, because a browser tab was
 * closed mid-write — so every subscriber call is wrapped, and a throwing one
 * is dropped rather than allowed to abort the fan-out.
 */
export class EventBus {
	private readonly subscribers = new Set<Subscriber>();

	/** Returns the unsubscribe function. Calling it twice is harmless. */
	subscribe(subscriber: Subscriber): () => void {
		this.subscribers.add(subscriber);
		return () => {
			this.subscribers.delete(subscriber);
		};
	}

	publish(event: ServerEvent): void {
		// Snapshot: a subscriber is allowed to unsubscribe from inside its own
		// delivery (the SSE stream does exactly that when its controller is
		// already closed), and mutating a Set mid-iteration is undefined enough
		// to be worth avoiding.
		for (const subscriber of [...this.subscribers]) {
			try {
				subscriber(event);
			} catch {
				// A broken client must not stop the others.
			}
		}
	}

	get size(): number {
		return this.subscribers.size;
	}
}
