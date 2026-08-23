import { z } from "zod";
import { GitHubError } from "../core/github/client.ts";
import { PromotionError } from "../core/promotion/index.ts";
import { RuleTransitionError } from "../core/rules/state.ts";
import { formatZodError } from "../shared/zod.ts";

export class HttpError extends Error {
	override name = "HttpError";
	constructor(
		readonly status: number,
		message: string,
	) {
		super(message);
	}
}

/**
 * The one place an error becomes a status code.
 *
 * A GitHubError is 502 and not 500: the failure is upstream, and spec section 7
 * requires GitHub's own text to reach the user verbatim, which `messageFor`
 * below guarantees by never rewriting an Error's message.
 */
export function statusFor(error: unknown): number {
	if (error instanceof HttpError) return error.status;
	if (error instanceof z.ZodError) return 400;
	if (error instanceof PromotionError) return 400;
	if (error instanceof RuleTransitionError) return 409;
	if (error instanceof GitHubError) return 502;
	return 500;
}

export function messageFor(error: unknown): string {
	if (error instanceof z.ZodError) {
		return `Invalid request:\n${formatZodError(error)}`;
	}
	if (error instanceof Error) return error.message;
	return String(error);
}

export function errorResponse(error: unknown): Response {
	return Response.json(
		{ error: { message: messageFor(error) } },
		{ status: statusFor(error) },
	);
}
