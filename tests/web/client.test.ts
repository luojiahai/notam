import { afterEach, describe, expect, test } from "bun:test";
import { z } from "zod";
import { ApiError, post, request } from "../../web/src/api/client.ts";

const original = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = original;
});

function stub(response: Response, seen: RequestInit[] = []) {
	globalThis.fetch = ((_input: unknown, init?: RequestInit) => {
		if (init) seen.push(init);
		return Promise.resolve(response);
	}) as typeof fetch;
	return seen;
}

const Shape = z.object({ ok: z.boolean() });

describe("the API client", () => {
	test("validates the response against the shared schema", async () => {
		stub(Response.json({ ok: true }));
		expect(await request(Shape, "/api/thing")).toEqual({ ok: true });
	});

	test("a response that does not match the schema throws", async () => {
		stub(Response.json({ ok: "yes" }));
		await expect(request(Shape, "/api/thing")).rejects.toThrow();
	});

	test("an error body's message is surfaced verbatim", async () => {
		stub(
			Response.json(
				{ error: { message: "403: Resource not accessible by integration" } },
				{ status: 502 },
			),
		);
		const failure = request(Shape, "/api/thing").catch(
			(error: unknown) => error,
		);
		const error = (await failure) as ApiError;
		expect(error).toBeInstanceOf(ApiError);
		expect(error.status).toBe(502);
		expect(error.message).toBe("403: Resource not accessible by integration");
	});

	test("a non-JSON error body still produces a readable ApiError", async () => {
		stub(new Response("upstream exploded", { status: 500 }));
		const error = (await request(Shape, "/api/thing").catch(
			(e: unknown) => e,
		)) as ApiError;
		expect(error).toBeInstanceOf(ApiError);
		expect(error.message).toContain("upstream exploded");
	});

	test("post sends JSON with the right method and content type", async () => {
		const seen = stub(Response.json({ ok: true }));
		await post(Shape, "/api/thing", { a: 1 });
		expect(seen[0]?.method).toBe("POST");
		expect(seen[0]?.body).toBe('{"a":1}');
		expect(new Headers(seen[0]?.headers).get("content-type")).toBe(
			"application/json",
		);
	});
});
