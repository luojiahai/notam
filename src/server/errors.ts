import { z } from "zod";
import {
	ConfigConflictError,
	ConfigError,
	ConfigValidationError,
} from "../core/config/load.ts";
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
 * A GitHubError is 502 and not 500: the failure is upstream, and GitHub's own
 * text has to reach the user verbatim, which `messageFor` below guarantees by
 * never rewriting an Error's message.
 *
 * A ConfigError is 503 and not 500, because it can genuinely reach a request:
 * a host whose `token_env` names a variable that is not set keeps its rows and
 * its clients resolve their tokens from those rows lazily. The server is
 * running and the code is fine; this one repository cannot be served until the
 * environment is fixed, and the message says exactly which variable to set.
 * Keeping it out of the 500 band also keeps 500 meaning "unexpected", which is
 * what app.ts logs.
 *
 * Its two siblings are the caller's problem rather than the environment's: a
 * ConfigValidationError is a document that parsed but cannot be accepted, and
 * a ConfigConflictError is an edit built on bytes the file no longer holds.
 */
export function statusFor(error: unknown): number {
	if (error instanceof HttpError) return error.status;
	if (error instanceof z.ZodError) return 400;
	if (error instanceof PromotionError) return 400;
	if (error instanceof RuleTransitionError) return 409;
	if (error instanceof ConfigValidationError) return 400;
	if (error instanceof ConfigConflictError) return 409;
	if (error instanceof GitHubError) return 502;
	if (error instanceof ConfigError) return 503;
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
