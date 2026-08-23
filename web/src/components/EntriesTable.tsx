import { Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import type {
	AnalysisState,
	EntryCounts,
	EntrySummary,
} from "../../../src/shared/api.ts";
import type { BatchState } from "../App.tsx";
import { isBusy } from "../lib/analysis.ts";
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
	const [pending, setPending] = useState<{
		ids: string[];
		clearAfter: boolean;
	} | null>(null);

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

	/**
	 * `clearAfter` is set by the bulk action and only by it. Those rows are
	 * queued the moment this returns, and a queued row usually stops matching
	 * the active chip — so it leaves the visible slice, `allBusy` falls back to
	 * the row remembered at selection time, and the button would sit there
	 * enabled offering a click the server can only skip. Dropping the selection
	 * is also what the user means: the work is handed off. A single row's own
	 * button must not clear it — that would discard a selection still being
	 * built.
	 */
	function requestAnalyse(ids: string[], clearAfter = false): void {
		if (draftCountFor(ids) > 0) {
			setPending({ ids, clearAfter });
			return;
		}
		props.onAnalyse(ids);
		if (clearAfter) selection.clear();
	}

	// The whole selection, not the visible slice: a row the filter hides is
	// still going to be sent, so it still decides whether the action does
	// anything. Disabled only when every one of them is busy — a mixed
	// selection stays actionable and the server skips the busy ids.
	const selected = selection.rows.map(
		(entry) => visible.get(entry.id) ?? entry,
	);
	const allBusy = selected.length > 0 && selected.every(isBusy);

	const pendingDrafts = pending === null ? 0 : draftCountFor(pending.ids);
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
				{/*
					The selection controls and the queue counter used to sit in a
					footer of their own below the table. They are one row's worth of
					chrome, and the table wants the height more than they did. Grouped
					so a narrow window drops the set to a second line together.
				*/}
				<div className="toolbar-actions">
					<span className="bulk-count" data-active={selection.size > 0}>
						{selection.size} selected
					</span>
					<button
						type="button"
						className="btn-primary"
						disabled={selection.size === 0 || allBusy}
						onClick={() => requestAnalyse(selection.ids, true)}
					>
						<Sparkles className="icon" aria-hidden="true" />
						Analyse selected ({selection.size})
					</button>
					{props.error && <span className="bulk-error">{props.error}</span>}
					<span className="toolbar-divider" />
					<span className="bulk-progress">
						{props.batch.running} running, {props.batch.queued} queued
					</span>
				</div>
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
										{/*
											One action for every state. The label is the same verb
											the toolbar and the drawer use; the aria-label carries
											the number so a table of them does not read as a column
											of identical "Analyse" buttons.
										*/}
										<button
											type="button"
											className="btn-sm"
											aria-label={`Analyse #${entry.number}`}
											disabled={isBusy(entry)}
											onClick={() => requestAnalyse([entry.id])}
										>
											<Sparkles className="icon" aria-hidden="true" />
											Analyse
										</button>
									</td>
								</tr>
							))}
						</tbody>
					</table>
				)}
			</div>

			{pending && (
				<Dialog
					title="Analyse"
					confirmLabel="Analyse"
					onCancel={() => setPending(null)}
					onConfirm={() => {
						props.onAnalyse(pending.ids);
						if (pending.clearAfter) selection.clear();
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
