import type { z } from "zod";
import { ApiErrorSchema } from "../../../src/shared/api.ts";

export class ApiError extends Error {
	override name = "ApiError";
	constructor(
		readonly status: number,
		message: string,
	) {
		super(message);
	}
}

/**
 * Every response is parsed with the same schema the server serialised it from.
 * A field the server stopped sending becomes a loud error here instead of
 * `undefined` rendered into a table cell three components away.
 *
 * Paths are relative: the SPA is served from the same origin as the API, and in
 * development Vite proxies `/api` to the running server.
 */
export async function request<T>(
	schema: z.ZodType<T>,
	path: string,
	init?: RequestInit,
): Promise<T> {
	const response = await fetch(path, init);
	const text = await response.text();

	let body: unknown = null;
	if (text !== "") {
		try {
			body = JSON.parse(text);
		} catch {
			throw new ApiError(
				response.status,
				response.ok
					? `The server returned a non-JSON body: ${text.slice(0, 300)}`
					: text.slice(0, 300),
			);
		}
	}

	if (!response.ok) {
		const parsed = ApiErrorSchema.safeParse(body);
		throw new ApiError(
			response.status,
			// GitHub's own text reaches the user unchanged.
			parsed.success
				? parsed.data.error.message
				: `${response.status} ${response.statusText}`,
		);
	}

	return schema.parse(body);
}

export function post<T>(
	schema: z.ZodType<T>,
	path: string,
	payload: unknown,
): Promise<T> {
	return request(schema, path, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(payload),
	});
}
