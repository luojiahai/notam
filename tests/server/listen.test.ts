import { describe, expect, test } from "bun:test";
import { listen } from "../../src/server/listen.ts";

const ok = () => new Response("ok");

describe("listen", () => {
	test("binds loopback and answers", async () => {
		const server = listen({ fetch: ok, port: 0, autoIncrement: false });
		expect(server.url).toBe(`http://127.0.0.1:${server.port}`);
		const response = await fetch(server.url);
		expect(await response.text()).toBe("ok");
		await server.stop();
	});

	test("auto-increments past a port that is already taken", async () => {
		const first = listen({ fetch: ok, port: 0, autoIncrement: false });
		const second = listen({
			fetch: ok,
			port: first.port,
			autoIncrement: true,
		});
		expect(second.port).toBeGreaterThan(first.port);
		await second.stop();
		await first.stop();
	});

	test("without auto-increment a taken port is an error naming it", () => {
		const first = listen({ fetch: ok, port: 0, autoIncrement: false });
		expect(() =>
			listen({ fetch: ok, port: first.port, autoIncrement: false }),
		).toThrow(String(first.port));
		void first.stop();
	});
});
