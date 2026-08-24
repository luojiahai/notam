import type { Database } from "bun:sqlite";
import { type JobHandler, POOL_STOPPED } from "../../jobs/pool.ts";
import type { JobQueue } from "../../jobs/queue.ts";
import type { AnalysedRule } from "../../shared/analysis.ts";
import type { EntryRow, NewRule, RepoRow } from "../../shared/types.ts";
import {
	getEntry,
	revertAnalysisState,
	setAnalysisState,
} from "../../store/entries.ts";
import { selectPendingAnalyseJobsForRepo } from "../../store/jobs.ts";
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
	| { type: "failed"; entryId: string; error: string }
	| { type: "cancelled"; entryId: string };

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
	/** Fires to stop this analysis: the child is killed and the abort re-thrown. */
	signal?: AbortSignal;
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
		signal,
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
				signal?.throwIfAborted();
				onProgress?.({ type: "attempt", entryId: entry.id, attempt: n });
				const run = await runner({
					instruction,
					stdin,
					model,
					timeoutMs,
					signal,
				});
				// Before `run.ok` is even consulted: a killed child exits
				// non-zero, which the branches below would otherwise read as a
				// transport fault and retry — spawning claude again on behalf
				// of a user who just asked for it to stop.
				signal?.throwIfAborted();
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
				// Deliberately not interruptible. The check at the top of the
				// next iteration catches an abort that lands during it, and the
				// wait it can add to a stop press is bounded by one backoff.
				if (n < maxTransportAttempts) await sleep(backoffMs(n));
			}
			return { ok: false, error: lastError, repairable: false };
		};

		let outcome = await attempt(INSTRUCTION);
		signal?.throwIfAborted();
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
		// A stop the user pressed is not a fault, so it must not travel the
		// `fail` path and land in the entry's `last_error`. It goes back to the
		// handler, which owns the difference between a cancellation and a
		// shutdown, and the pool records the job's outcome from there.
		if (signal?.aborted) throw error;
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
	return async (job, signal) => {
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
		try {
			const result = await analyseEntry({ ...deps, signal }, entry, repo);
			onResult?.(result);
			if (result.state === "failed") {
				throw new AnalysisError(result.error ?? "analysis failed");
			}
		} catch (error) {
			// This is the seam that knows the difference, because it is the one
			// that speaks both languages: `analyseEntry` re-throws every abort
			// alike, and only here is the pool's reason available.
			//
			// A shutdown returns the job to the queue, so the entry has to stay
			// `running` for `requeueRunningEntries` to reconcile at the next
			// start. Reverting it would leave an `unanalysed` entry with a
			// queued job behind it, which nothing repairs.
			if (signal.aborted && signal.reason !== POOL_STOPPED) {
				revertAnalysisState(deps.db, entry.id);
				deps.onProgress?.({ type: "cancelled", entryId: entry.id });
			}
			throw error;
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

/**
 * Stops one entry's analysis. `"aborted"` reached a run in flight, `"dequeued"`
 * took a job that had never been claimed, and null means there was nothing
 * pending — which is an outcome, not an error.
 */
export type CancelOutcome = "aborted" | "dequeued" | null;

/**
 * Injected rather than imported: cancelling a claimed job means aborting a
 * signal the server's `JobRunner` holds, and `core/` cannot reach into
 * `server/`.
 */
export type EntryCanceller = (entryId: string) => CancelOutcome;

export type CancelResult = { cancelled: string[]; skipped: string[] };

/**
 * The inverse of `queueEntries`: stops a selection, whether each entry's job
 * was already running or merely waiting.
 *
 * Only the dequeued entries are written back here. A job that was aborted is
 * still unwinding inside its handler, and that handler is what reverts it — so
 * the entry is written in exactly one place per path, and nothing races a live
 * run to its own row.
 */
export function cancelEntries(
	db: Database,
	cancel: EntryCanceller,
	entryIds: string[],
	onProgress?: (event: AnalysisEvent) => void,
): CancelResult {
	const cancelled: string[] = [];
	const skipped: string[] = [];
	for (const entryId of entryIds) {
		const outcome = cancel(entryId);
		if (outcome === null) {
			skipped.push(entryId);
			continue;
		}
		if (outcome === "dequeued") {
			revertAnalysisState(db, entryId);
			onProgress?.({ type: "cancelled", entryId });
		}
		cancelled.push(entryId);
	}
	return { cancelled, skipped };
}

/**
 * Stops everything pending for one repository.
 *
 * The work is found in the jobs table rather than in `entries.analysis_state`,
 * so this acts only on entries the queue can vouch for. There is no `skipped`
 * to report: nothing was asked for by id, so nothing can be absent.
 */
export function cancelRepoEntries(
	db: Database,
	cancel: EntryCanceller,
	repoId: string,
	onProgress?: (event: AnalysisEvent) => void,
): { cancelled: string[] } {
	const entryIds = selectPendingAnalyseJobsForRepo(db, repoId).map(
		(job) => job.target_id,
	);
	return {
		cancelled: cancelEntries(db, cancel, entryIds, onProgress).cancelled,
	};
}
