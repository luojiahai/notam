import type { AnalysisState } from "../../../src/shared/api.ts";

/**
 * An entry with a job already in the queue.
 *
 * `queueEntries` (src/core/analysis/index.ts) refuses to double-queue one and
 * reports it as skipped, so a control that dispatches it spends a click on a
 * no-op. Shared rather than repeated because the entries table, its bulk
 * action, and the panel all have to agree on it — and they take different
 * shapes (`EntrySummary`, `EntryDetail`), so it is typed structurally.
 */
export function isBusy(entry: { analysis_state: AnalysisState }): boolean {
	return (
		entry.analysis_state === "queued" || entry.analysis_state === "running"
	);
}
