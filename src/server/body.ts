import type { Context } from "hono";
import type { z } from "zod";
import { HttpError } from "./errors.ts";

/**
 * Every POST body goes through here. Malformed JSON is the caller's mistake, so
 * it is a 400 with a sentence a human can act on rather than a SyntaxError
 * escaping as a 500.
 */
export async function readBody<T>(
	c: Context,
	schema: z.ZodType<T>,
): Promise<T> {
	let raw: unknown;
	try {
		raw = await c.req.json();
	} catch {
		throw new HttpError(400, "Request body must be JSON");
	}
	return schema.parse(raw);
}
