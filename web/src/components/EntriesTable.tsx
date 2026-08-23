import { useEffect, useState } from "react";
import type {
	AnalysisState,
	EntryCounts,
	EntrySummary,
} from "../../../src/shared/api.ts";
import type { BatchState } from "../App.tsx";
import { useSelection } from "../state/selection.ts";
import { StatusPill } from "./Badge.tsx";
import { Dialog } from "./Dialog.tsx";
import { type Chip, FilterChips } from "./FilterChips.tsx";
import { TableEmpty, TableSkeleton } from "./TableState.tsx";

export type EntriesTableProps = {
	entries: EntrySummary[];
	counts: EntryCounts;
	state: AnalysisState | "";
	onStateChange: (state: AnalysisState | "") => void;
	query: string;
	onQueryChange: (query: string) => void;
	onOpenEntry: (entryId: string) => void;
	onAnalyse: (entryIds: string[]) => void;
	onAnalyseAllUnanalysed: () => void;
	batch: BatchState;
	loading: boolean;
	/** The last mutation failure, verbatim from the server. */
	error?: string | null;
};

const STATE_LABELS: Record<AnalysisState, string> = {
	unanalysed: "Unanalysed",
	queued: "Queued",
	running: "Running",
	analysed: "Analysed",
	failed: "Failed",
};

/** ISO, not a locale format: a table of dates should sort by eye and never move under a test. */
function day(timestamp: string | null): string | null {
	return timestamp === null ? null : timestamp.slice(0, 10);
}

/**
 * Presentational on purpose. Everything it needs arrives as a prop and every
 * decision leaves as a callback, so the confirmation rule below — the one part
 * of this screen that can lose a user's work — is testable without a server.
 */
export function EntriesTable(props: EntriesTableProps) {
	const selection = useSelection<EntrySummary>();
	const [pending, setPending] = useState<string[] | null>(null);

	const visibleIds = props.entries.map((entry) => entry.id);
	const allSelected =
		visibleIds.length > 0 && visibleIds.every((id) => selection.has(id));

	// A selection must never outlive the row set it was made in. The chip and
	// the search box change which rows exist, and `clear` is stable, so this
	// fires exactly on a context change — the repository switch is covered by
	// App keying the tab on `repoId`.
	const { clear } = selection;
	// biome-ignore lint/correctness/useExhaustiveDependencies: the context props are the trigger, not values the effect reads; `clear` is a stable useCallback.
	useEffect(() => {
		clear();
	}, [props.state, props.query]);

	const chips: Chip[] = (
		["unanalysed", "analysed", "failed"] as AnalysisState[]
	).map((state) => ({
		value: state,
		label: STATE_LABELS[state],
		count: props.counts[state],
	}));

	const visible = new Map(props.entries.map((entry) => [entry.id, entry]));

	/**
	 * Spec section 6: a re-run that would discard drafts must say how many.
	 *
	 * The count comes from the visible row where there is one and from the
	 * remembered selected row otherwise, so an id the current filter hides
	 * still contributes its drafts. Counting only the visible slice would
	 * report zero and skip the confirmation entirely.
	 */
	function draftCountFor(ids: string[]): number {
		return ids.reduce((sum, id) => {
			const entry = visible.get(id) ?? selection.get(id);
			return sum + (entry?.draft_rule_count ?? 0);
		}, 0);
	}

	function requestAnalyse(ids: string[]): void {
		if (draftCountFor(ids) > 0) {
			setPending(ids);
			return;
		}
		props.onAnalyse(ids);
	}

	const pendingDrafts = pending === null ? 0 : draftCountFor(pending);
	const filtered = props.state !== "" || props.query !== "";

	return (
		<>
			<div className="toolbar">
				<FilterChips
					chips={chips}
					active={props.state}
					onChange={(value) => props.onStateChange(value as AnalysisState | "")}
				/>
				<input
					type="search"
					aria-label="Search entries"
					placeholder="Filter by title, author, or path"
					value={props.query}
					onChange={(event) => props.onQueryChange(event.target.value)}
				/>
				<span className="spacer" />
				<button
					type="button"
					onClick={props.onAnalyseAllUnanalysed}
					disabled={props.counts.unanalysed === 0}
				>
					Analyse all {props.counts.unanalysed} unanalysed
				</button>
			</div>

			<div className="table-wrap">
				{props.loading ? (
					<TableSkeleton />
				) : props.entries.length === 0 ? (
					<TableEmpty
						title={
							filtered ? "No entries match this filter." : "No entries yet."
						}
						hint={
							filtered
								? "Clear the filter or widen the search to see the rest."
								: "Sync this repository to pull in its merged pull requests."
						}
					/>
				) : (
					<table>
						<thead>
							<tr>
								<th>
									<input
										type="checkbox"
										aria-label="Select all entries"
										checked={allSelected}
										onChange={() =>
											allSelected
												? selection.clear()
												: selection.setAll(props.entries)
										}
									/>
								</th>
								<th>PR</th>
								<th>Title</th>
								<th className="num">Files</th>
								<th className="num">Comments</th>
								<th>Author</th>
								<th>Merged</th>
								<th>Analysis</th>
								<th />
							</tr>
						</thead>
						<tbody>
							{props.entries.map((entry) => (
								<tr key={entry.id}>
									<td>
										<input
											type="checkbox"
											aria-label={`Select #${entry.number}`}
											checked={selection.has(entry.id)}
											onChange={() => selection.toggle(entry)}
										/>
									</td>
									<td className="mono">
										<a href={entry.url} target="_blank" rel="noreferrer">
											#{entry.number}
										</a>
									</td>
									<td className="cell-title">
										<button
											type="button"
											className="btn-plain"
											onClick={() => props.onOpenEntry(entry.id)}
										>
											{entry.title}
										</button>
										{entry.matched_prefix && (
											<div className="secondary mono">
												{entry.matched_prefix}
											</div>
										)}
										{entry.last_error && (
											<div className="cell-error">{entry.last_error}</div>
										)}
									</td>
									<td className="num">
										{entry.changed_file_count}
										{entry.paths_truncated && (
											<span
												className="truncated"
												title="This pull request changed more than 300 files; the list is truncated."
											>
												{" "}
												⚠
											</span>
										)}
									</td>
									<td className="num">{entry.comment_count}</td>
									<td>{entry.author}</td>
									<td className="mono">
										{day(entry.merged_at) ?? (
											<span className="faint">not merged</span>
										)}
									</td>
									<td>
										<StatusPill status={entry.analysis_state} />
									</td>
									<td>
										{entry.analysis_state === "failed" ? (
											<button
												type="button"
												className="btn-sm"
												onClick={() => requestAnalyse([entry.id])}
											>
												Retry
											</button>
										) : entry.analysis_state === "unanalysed" ? null : (
											<details className="row-menu">
												<summary aria-label={`Actions for #${entry.number}`}>
													⋯
												</summary>
												<div className="row-menu-panel">
													<button
														type="button"
														onClick={() => requestAnalyse([entry.id])}
													>
														Re-analyse
													</button>
												</div>
											</details>
										)}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				)}
			</div>

			<div className="bulk">
				<span className="bulk-count" data-active={selection.size > 0}>
					{selection.size} selected
				</span>
				<button
					type="button"
					className="btn-primary"
					disabled={selection.size === 0}
					onClick={() => requestAnalyse(selection.ids)}
				>
					Analyse selected ({selection.size})
				</button>
				{props.error && <span className="bulk-error">{props.error}</span>}
				<span className="spacer" />
				<span className="bulk-progress">
					{props.batch.running} running, {props.batch.queued} queued
				</span>
			</div>

			{pending && (
				<Dialog
					title="Re-analyse"
					confirmLabel="Re-analyse"
					onCancel={() => setPending(null)}
					onConfirm={() => {
						props.onAnalyse(pending);
						setPending(null);
					}}
				>
					<p>
						This will discard {pendingDrafts} draft rule
						{pendingDrafts === 1 ? "" : "s"} and re-run analysis.
					</p>
					<p className="secondary">
						Proposed, verified, and abandoned rules are untouched. The stored
						pull request payload is reused, so re-sync first if the conversation
						has changed.
					</p>
				</Dialog>
			)}
		</>
	);
}
