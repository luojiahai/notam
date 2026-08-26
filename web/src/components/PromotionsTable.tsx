import { RefreshCw } from "lucide-react";
import type {
	PromotionState,
	PromotionSummary,
} from "../../../src/shared/api.ts";
import { day } from "../lib/day.ts";
import type { PromotionCounts } from "../lib/promotions.ts";
import { StatusPill } from "./Badge.tsx";
import { type Chip, FilterChips } from "./FilterChips.tsx";
import { TableEmpty, TableSkeleton } from "./TableState.tsx";

export type PromotionsTableProps = {
	promotions: PromotionSummary[];
	/** Counted from the whole repository, so a chip keeps its number while it filters. */
	counts: PromotionCounts;
	state: PromotionState | "";
	onStateChange: (state: PromotionState | "") => void;
	query: string;
	onQueryChange: (query: string) => void;
	onRefresh: () => void;
	refreshing: boolean;
	loading: boolean;
	/** The last refresh failure, verbatim from the server. */
	error?: string | null;
};

const STATE_LABELS: Record<PromotionState, string> = {
	open: "Open",
	merged: "Merged",
	closed: "Closed",
};

/**
 * Presentational, matching EntriesTable and RulesTable: everything arrives as
 * a prop and every decision leaves as a callback.
 *
 * The rows carry no checkbox and no per-row control, which is the one place
 * this table departs from its siblings. A promotion is a pull request that has
 * already been opened — nothing about it is editable from here, and a
 * selection column that enables nothing reads as a broken one.
 */
export function PromotionsTable(props: PromotionsTableProps) {
	const chips: Chip[] = (["open", "merged", "closed"] as PromotionState[]).map(
		(state) => ({
			value: state,
			label: STATE_LABELS[state],
			count: props.counts[state],
		}),
	);

	const filtered = props.state !== "" || props.query !== "";

	return (
		<>
			<div className="toolbar">
				<FilterChips
					chips={chips}
					active={props.state}
					onChange={(value) =>
						props.onStateChange(value as PromotionState | "")
					}
				/>
				<input
					type="search"
					aria-label="Filter promotions by branch or pull request number"
					placeholder="Filter by branch or PR number"
					value={props.query}
					onChange={(event) => props.onQueryChange(event.target.value)}
				/>
				<span className="spacer" />
				{/*
					Grouped like the other two toolbars so the set drops to a second
					line together on a narrow window. Labelled rather than
					icon-only: the row has the width for it, and the button sits
					directly above the list it rewrites.
				*/}
				<div className="toolbar-actions">
					<button
						type="button"
						aria-busy={props.refreshing}
						onClick={props.onRefresh}
						disabled={props.refreshing}
						data-busy={props.refreshing}
					>
						<RefreshCw className="icon" aria-hidden="true" />
						Refresh status
					</button>
					{props.error && <span className="bulk-error">{props.error}</span>}
				</div>
			</div>

			<div className="table-wrap" aria-busy={props.loading}>
				{props.loading ? (
					<TableSkeleton />
				) : props.promotions.length === 0 ? (
					<TableEmpty
						title={
							filtered
								? "No promotions match this filter."
								: "No promotions yet."
						}
						hint={
							filtered
								? "Clear the filter or widen the search to see the rest."
								: "Select draft rules in the Rules tab and create a rules pull request."
						}
					/>
				) : (
					<table>
						<thead>
							<tr>
								<th>PR</th>
								<th>State</th>
								<th className="num">Rules</th>
								<th>Created</th>
								<th>Checked</th>
							</tr>
						</thead>
						<tbody>
							{props.promotions.map((promotion) => (
								<tr key={promotion.id}>
									{/*
										The branch is written before the pull request exists, so
										this cell reads without one. It leads with the number
										when there is one, because that is the handle the team
										talks in, and carries the branch underneath in full: a
										truncated branch is not a branch anyone can check out.
									*/}
									<td className="cell-title mono">
										{promotion.pr_url && promotion.pr_number !== null ? (
											<>
												<a
													href={promotion.pr_url}
													target="_blank"
													rel="noreferrer"
												>
													#{promotion.pr_number}
												</a>
												<div className="secondary">{promotion.branch}</div>
											</>
										) : (
											promotion.branch
										)}
									</td>
									<td>
										<StatusPill status={promotion.state} />
									</td>
									<td className="num">{promotion.rule_count}</td>
									<td className="mono">{day(promotion.created_at)}</td>
									<td className="mono">
										{day(promotion.last_checked_at) ?? (
											<span className="faint">never</span>
										)}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				)}
			</div>
		</>
	);
}
