import { useEffect, useRef } from "react";
import {
	type ServerEvent,
	ServerEventSchema,
} from "../../../src/shared/api.ts";

/**
 * One EventSource for the whole app, mounted once at the root.
 *
 * The handler is held in a ref so a caller may pass an inline closure without
 * tearing the connection down on every render — reconnecting on each keystroke
 * would drop exactly the progress events the user is watching for.
 *
 * The `EventSource` guard is not defensive padding: the component test
 * environment does not implement it, and a live progress feed is not what those
 * tests are asserting on.
 */
export function useServerEvents(handler: (event: ServerEvent) => void): void {
	const ref = useRef(handler);
	ref.current = handler;

	useEffect(() => {
		if (typeof EventSource === "undefined") return;
		const source = new EventSource("/api/events");
		source.onmessage = (message: MessageEvent<string>) => {
			let raw: unknown;
			try {
				raw = JSON.parse(message.data);
			} catch {
				return;
			}
			const parsed = ServerEventSchema.safeParse(raw);
			if (parsed.success) ref.current(parsed.data);
		};
		return () => source.close();
	}, []);
}
