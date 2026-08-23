import type { Database } from "bun:sqlite";
import type { JobHandler } from "../../jobs/pool.ts";
import type { JobQueue } from "../../jobs/queue.ts";
import type { AnalysedRule } from "../../shared/analysis.ts";
import type { EntryRow, NewRule, RepoRow } from "../../shared/types.ts";
import { getEntry, setAnalysisState } from "../../store/entries.ts";
import { getRepo } from "../../store/repos.ts";
import { deleteDraftRulesForEntry, insertRules } from "../../store/rules.ts";
import { slugify } from "../rules/slug.ts";
import { parseAnalyserOutput } from "./parse.ts";
import type { ClaudeRunner } from "./runner.ts";
import {
	INSTRUCTION,
	loadPromptTemplate,
	renderTemplate,
	repairInstruction,
} from "./template.ts";

/** Config's `analysis.timeout_seconds` default, in milliseconds. */
export const DEFAULT_TIMEOUT_MS = 120_000;
/** One attempt plus the two retries allowed for a timeout or a non-zero exit. */
export const DEFAULT_TRANSPORT_ATTEMPTS = 3;

export type AnalysisEvent =
	| { type: "started"; entryId: string }
	| { type: "attempt"; entryId: string; attempt: number }
	| { type: "repairing"; entryId: string; error: string }
	| { type: "analysed"; entryId: string; rules: number }
	| { type: "failed"; entryId: string; error: string };

export type AnalysisResult = {
	entryId: string;
	state: "analysed" | "failed";
	rules: number;
	error: string | null;
};

export type AnalysisDeps = {
	db: Database;
	runner: ClaudeRunner;
	now: () => Date;
	timeoutMs?: number;
	model?: string;
	maxTransportAttempts?: number;
	backoffMs?: (attempt: number) => number;
	sleep?: (ms: number) => Promise<void>;
	/** Resolves a repository's prompt_template. Injected so tests need no files. */
	loadTemplate?: (path: string | null) => Promise<string>;
	onProgress?: (event: AnalysisEvent) => void;
};

/** Thrown by the job handler so the job row carries the same text as the entry. */
export class AnalysisError extends Error {
	override name = "AnalysisError";
}

type Attempt =
	| { ok: true; rules: AnalysedRule[] }
	| { ok: false; error: string; repairable: boolean };

function toNewRule(rule: AnalysedRule): NewRule {
	return { ...rule, file_slug: slugify(rule.directive) };
}

function describe(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/**
 * Two independent retry budgets:
 *
 * - transport (timeout, non-zero exit) retries twice with backoff *within* one
 *   attempt, because the model never saw the request;
 * - validation gets exactly one repair attempt, re-prompted with the
 *   validator's own error text, because the model did see it and got it wrong.
 *
 * A missing `claude` short-circuits both: no amount of retrying installs it.
 *
 * Drafts are deleted in the same transaction that inserts the replacements, so
 * a failed re-analysis leaves the previous drafts intact rather than trading
 * them for nothing.
 */
export async function analyseEntry(
	deps: AnalysisDeps,
	entry: EntryRow,
	repo: RepoRow,
): Promise<AnalysisResult> {
	const {
		db,
		runner,
		now,
		onProgress,
		model,
		timeoutMs = DEFAULT_TIMEOUT_MS,
		maxTransportAttempts = DEFAULT_TRANSPORT_ATTEMPTS,
		backoffMs = (attempt: number) => 500 * 2 ** (attempt - 1),
		sleep = (ms: number) => Bun.sleep(ms),
		loadTemplate = (path: string | null) => loadPromptTemplate(path),
	} = deps;

	onProgress?.({ type: "started", entryId: entry.id });
	setAnalysisState(db, entry.id, "running", { error: null });

	const fail = (error: string): AnalysisResult => {
		setAnalysisState(db, entry.id, "failed", { error });
		onProgress?.({ type: "failed", entryId: entry.id, error });
		return { entryId: entry.id, state: "failed", rules: 0, error };
	};

	// Everything from here on runs after the entry has been marked `running`.
	// Both `onProgress` and `runner` are injected, so an unexpected throw from
	// either of them — or from the transaction below — is a supported case, not
	// a hypothetical: without this guard it would escape analyseEntry entirely
	// and strand the entry `running` forever, with `last_error` still null.
	try {
		let stdin: string;
		try {
			const template = await loadTemplate(repo.prompt_template);
			stdin = renderTemplate(template, entry);
		} catch (error) {
			return fail(describe(error));
		}

		const attempt = async (instruction: string): Promise<Attempt> => {
			let lastError = "the analyser produced no output";
			for (let n = 1; n <= maxTransportAttempts; n++) {
				onProgress?.({ type: "attempt", entryId: entry.id, attempt: n });
				const run = await runner({ instruction, stdin, model, timeoutMs });
				if (run.ok) {
					const parsed = parseAnalyserOutput(run.stdout);
					return parsed.ok
						? { ok: true, rules: parsed.rules }
						: { ok: false, error: parsed.error, repairable: true };
				}
				lastError = run.message;
				if (run.kind === "missing") {
					return { ok: false, error: run.message, repairable: false };
				}
				if (n < maxTransportAttempts) await sleep(backoffMs(n));
			}
			return { ok: false, error: lastError, repairable: false };
		};

		let outcome = await attempt(INSTRUCTION);
		if (!outcome.ok && outcome.repairable) {
			onProgress?.({
				type: "repairing",
				entryId: entry.id,
				error: outcome.error,
			});
			outcome = await attempt(repairInstruction(outcome.error));
		}
		if (!outcome.ok) return fail(outcome.error);

		const timestamp = now();
		const rules = outcome.rules;
		db.transaction(() => {
			deleteDraftRulesForEntry(db, entry.id);
			insertRules(db, repo.id, entry.id, rules.map(toNewRule), timestamp);
			setAnalysisState(db, entry.id, "analysed", {
				analysedAt: timestamp.toISOString(),
				error: null,
			});
		})();

		onProgress?.({ type: "analysed", entryId: entry.id, rules: rules.length });
		return {
			entryId: entry.id,
			state: "analysed",
			rules: rules.length,
			error: null,
		};
	} catch (error) {
		return fail(describe(error));
	}
}

/**
 * Adapts analyseEntry to the worker pool: an `analyse` job's target_id is an
 * entry id. Run the pool with its default `maxAttempts: 1` — analyseEntry owns
 * the retry policy, and a second budget on top of it would multiply out to nine
 * subprocess spawns for one entry.
 */
export function createAnalyseHandler(
	deps: AnalysisDeps,
	onResult?: (result: AnalysisResult) => void,
): JobHandler {
	return async (job) => {
		const entry = getEntry(deps.db, job.target_id);
		if (!entry) {
			throw new AnalysisError(
				`analyse job ${job.id} targets unknown entry ${job.target_id}`,
			);
		}
		const repo = getRepo(deps.db, entry.repo_id);
		if (!repo) {
			throw new AnalysisError(
				`entry ${entry.id} references unknown repo ${entry.repo_id}`,
			);
		}
		const result = await analyseEntry(deps, entry, repo);
		onResult?.(result);
		if (result.state === "failed") {
			throw new AnalysisError(result.error ?? "analysis failed");
		}
	};
}

/**
 * Queues a selection for analysis. An entry that already has a queued or
 * running job is reported as skipped rather than double-queued — the jobs
 * table's partial unique index is what makes that check race-free.
 */
export function queueEntries(
	db: Database,
	queue: JobQueue,
	entryIds: string[],
): { queued: string[]; skipped: string[] } {
	const queued: string[] = [];
	const skipped: string[] = [];
	for (const entryId of entryIds) {
		if (queue.enqueue("analyse", entryId)) {
			setAnalysisState(db, entryId, "queued", { error: null });
			queued.push(entryId);
		} else {
			skipped.push(entryId);
		}
	}
	return { queued, skipped };
}
