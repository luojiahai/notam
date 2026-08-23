import {
	type AnalysedRule,
	AnalysedRulesSchema,
} from "../../shared/analysis.ts";
import { formatZodError } from "../../shared/zod.ts";

export type ParseResult =
	| { ok: true; rules: AnalysedRule[] }
	| { ok: false; error: string };

type Envelope = { result?: unknown; is_error?: unknown };

/**
 * `--output-format json` wraps the model's text in an envelope whose `result`
 * field holds it. Anything that is not that envelope is treated as the text
 * itself, so a fake analyser in a test — or a future --output-format text — is
 * still parseable, and a genuinely broken reply fails later with a message
 * about the JSON block rather than about the envelope.
 */
export function extractResultText(stdout: string): string {
	const trimmed = stdout.trim();
	if (!trimmed.startsWith("{")) return stdout;
	try {
		const parsed = JSON.parse(trimmed) as Envelope;
		if (typeof parsed.result === "string") return parsed.result;
	} catch {
		// Not an envelope. Fall through.
	}
	return stdout;
}

function envelopeError(stdout: string): string | null {
	const trimmed = stdout.trim();
	if (!trimmed.startsWith("{")) return null;
	try {
		const parsed = JSON.parse(trimmed) as Envelope;
		if (parsed.is_error === true) {
			return typeof parsed.result === "string"
				? parsed.result
				: "unknown error";
		}
	} catch {
		return null;
	}
	return null;
}

/** Scans for the first `[` and returns through its matching `]`, ignoring brackets inside strings. */
function balancedArray(text: string): string | null {
	const start = text.indexOf("[");
	if (start === -1) return null;
	let depth = 0;
	let inString = false;
	let escaped = false;
	for (let i = start; i < text.length; i++) {
		const char = text[i];
		if (escaped) {
			escaped = false;
			continue;
		}
		if (char === "\\") {
			escaped = true;
			continue;
		}
		if (char === '"') {
			inString = !inString;
			continue;
		}
		if (inString) continue;
		if (char === "[") depth++;
		else if (char === "]") {
			depth--;
			if (depth === 0) return text.slice(start, i + 1);
		}
	}
	return null;
}

/**
 * A fenced block wins over a bare array, because a model that explains itself
 * often quotes a fragment in prose before the real answer.
 */
export function extractJsonBlock(text: string): string | null {
	const fenced = text.match(/```(?:json)?\s*\n([\s\S]*?)```/);
	if (fenced?.[1]) return fenced[1].trim();
	return balancedArray(text);
}

/** stdout -> validated rules, with a message the repair retry can quote back. */
export function parseAnalyserOutput(stdout: string): ParseResult {
	const flagged = envelopeError(stdout);
	if (flagged !== null) {
		return { ok: false, error: `the analyser reported an error: ${flagged}` };
	}

	const text = extractResultText(stdout);
	const block = extractJsonBlock(text);
	if (block === null) {
		return {
			ok: false,
			error: `the reply contained no JSON array:\n${text.slice(0, 500)}`,
		};
	}

	let value: unknown;
	try {
		value = JSON.parse(block);
	} catch (cause) {
		return {
			ok: false,
			error: `the JSON block was not valid JSON: ${cause instanceof Error ? cause.message : String(cause)}`,
		};
	}

	const parsed = AnalysedRulesSchema.safeParse(value);
	if (!parsed.success) {
		return {
			ok: false,
			error: `the JSON did not match the rule schema:\n${formatZodError(parsed.error)}`,
		};
	}
	return { ok: true, rules: parsed.data };
}
