import { useEffect } from "react";
import type { RuleSummary } from "../../../src/shared/api.ts";
import { useSelection } from "../state/selection.ts";
import { Badge, StatusPill } from "./Badge.tsx";
import { Confidence } from "./Confidence.tsx";
import { TableEmpty, TableSkeleton } from "./TableState.tsx";

export type RulesTableProps = {
	rules: RuleSummary[];
	query: string;
	onQueryChange: (query: string) => void;
	onOpenRule: (ruleId: string) => void;
	/**
	 * Absent on a stage whose rules can no longer move. An abandoned rule is
	 * terminal, and a checkbox column that enables nothing reads as a broken
	 * one, so those stages render without a selection at all.
	 */
	selection?: {
		onAbandon: (ruleIds: string[]) => void;
		onCreatePromotion: (ruleIds: string[]) => void;
	};
	loading: boolean;
	emptyTitle: string;
	emptyHint: string;
	/** The last mutation failure, verbatim from the server. */
	error?: string | null;
};

/**
 * The scanning view of one stage's rules. It no longer carries a status
 * filter: the pipeline above it *is* that filter, and a second set of controls
 * meaning the same thing is how a screen ends up with two answers to the same
 * question.
 *
 * Presentational on purpose — everything arrives as a prop and every decision
 * leaves as a callback, so the selection-dependent rules below are testable
 * without a server.
 */
export function RulesTable(props: RulesTableProps) {
	const selection = useSelection<RuleSummary>();

	// A selection must never outlive the row set it was made in. The search box
	// changes which rows exist, and `clear` is stable, so this fires exactly on
	// a context change — the repository and stage switches are covered by App
	// keying the stage on both.
	const { clear } = selection;
	// biome-ignore lint/correctness/useExhaustiveDependencies: the query is the trigger, not a value the effect reads; `clear` is a stable useCallback.
	useEffect(() => {
		clear();
	}, [props.query]);

	const visibleIds = props.rules.map((rule) => rule.id);
	const allSelected =
		visibleIds.length > 0 && visibleIds.every((id) => selection.has(id));

	// The whole selection, not the visible slice: a rule the search box hides is
	// still going to be sent, so it still has to be able to veto a bulk action.
	// Visible rows are taken fresh in case a refetch moved them.
	const visible = new Map(props.rules.map((rule) => [rule.id, rule]));
	const selected = selection.rows.map((rule) => visible.get(rule.id) ?? rule);

	// The button states encode the rule lifecycle's state machine. The server
	// re-checks every one of them — this only keeps the user from being told
	// "409" for something the screen could have greyed out.
	const allDraft =
		selected.length > 0 && selected.every((rule) => rule.status === "draft");
	const anyAbandoned = selected.some((rule) => rule.status === "abandoned");

	const selectable = props.selection !== undefined;

	return (
		<>
			<div className="toolbar">
				<input
					type="search"
					aria-label="Filter rules by directive"
					placeholder="Filter by directive"
					value={props.query}
					onChange={(event) => props.onQueryChange(event.target.value)}
				/>
				<span className="spacer" />
				{props.selection && (
					<div className="toolbar-actions">
						<span className="bulk-count" data-active={selection.size > 0}>
							{selection.size} selected
						</span>
						<button
							type="button"
							className="btn-primary"
							disabled={!allDraft}
							onClick={() => props.selection?.onCreatePromotion(selection.ids)}
						>
							Create rules PR ({selection.size})
						</button>
						<button
							type="button"
							className="btn-danger"
							disabled={selection.size === 0 || anyAbandoned}
							onClick={() => props.selection?.onAbandon(selection.ids)}
						>
							Abandon
						</button>
						{props.error && <span className="bulk-error">{props.error}</span>}
					</div>
				)}
			</div>

			<div className="table-wrap">
				{props.loading ? (
					<TableSkeleton />
				) : props.rules.length === 0 ? (
					<TableEmpty title={props.emptyTitle} hint={props.emptyHint} />
				) : (
					<table>
						<thead>
							<tr>
								{selectable && (
									<th>
										<input
											type="checkbox"
											aria-label="Select all rules"
											checked={allSelected}
											onChange={() =>
												allSelected
													? selection.clear()
													: selection.setAll(props.rules)
											}
										/>
									</th>
								)}
								<th>Type</th>
								<th>Directive</th>
								<th>Scope</th>
								<th>Confidence</th>
								<th>Source</th>
								<th>Status</th>
							</tr>
						</thead>
						<tbody>
							{props.rules.map((rule) => (
								<tr key={rule.id}>
									{selectable && (
										<td>
											<input
												type="checkbox"
												aria-label={`Select ${rule.directive}`}
												checked={selection.has(rule.id)}
												onChange={() => selection.toggle(rule)}
											/>
										</td>
									)}
									<td>
										<Badge>{rule.type}</Badge>
									</td>
									<td className="cell-title">
										<button
											type="button"
											className="btn-plain cell-directive"
											onClick={() => props.onOpenRule(rule.id)}
										>
											{rule.directive}
										</button>
										<div className="secondary">{rule.rationale}</div>
									</td>
									<td className="secondary mono">
										{rule.scope_globs.length === 0
											? "whole repository"
											: rule.scope_globs.join(", ")}
									</td>
									<td>
										<Confidence value={rule.confidence} />
									</td>
									<td className="mono">
										<a href={rule.source_url} target="_blank" rel="noreferrer">
											#{rule.source_number}
										</a>
									</td>
									<td>
										<StatusPill status={rule.status} />
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
