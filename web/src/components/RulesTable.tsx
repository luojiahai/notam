import { useEffect } from "react";
import type {
	RuleCounts,
	RuleStatus,
	RuleSummary,
} from "../../../src/shared/api.ts";
import { useSelection } from "../state/selection.ts";
import { Badge, StatusPill } from "./Badge.tsx";
import { type Chip, FilterChips } from "./FilterChips.tsx";
import { TableEmpty, TableSkeleton } from "./TableState.tsx";

export type RulesTableProps = {
	rules: RuleSummary[];
	counts: RuleCounts;
	status: RuleStatus | "";
	onStatusChange: (status: RuleStatus | "") => void;
	query: string;
	onQueryChange: (query: string) => void;
	onOpenRule: (ruleId: string) => void;
	onAbandon: (ruleIds: string[]) => void;
	onVerify: (ruleIds: string[]) => void;
	onCreatePromotion: (ruleIds: string[]) => void;
	loading: boolean;
	/** The last mutation failure, verbatim from the server. */
	error?: string | null;
};

const STATUS_LABELS: Record<RuleStatus, string> = {
	draft: "Draft",
	proposed: "Proposed",
	verified: "Verified",
	abandoned: "Abandoned",
};

/**
 * Presentational on purpose, matching EntriesTable's shape: everything it
 * needs arrives as a prop and every decision leaves as a callback, so the
 * selection-dependent bulk-action rules below are testable without a server.
 */
export function RulesTable(props: RulesTableProps) {
	const selection = useSelection<RuleSummary>();
	const visibleIds = props.rules.map((rule) => rule.id);
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
	}, [props.status, props.query]);

	// The whole selection, not the visible slice: a rule the current filter
	// hides is still going to be sent, so it still has to be able to veto a
	// bulk action. Visible rows are taken fresh in case a refetch moved them.
	const visible = new Map(props.rules.map((rule) => [rule.id, rule]));
	const selected = selection.rows.map((rule) => visible.get(rule.id) ?? rule);

	// The button states encode the rule lifecycle's state machine. The server
	// re-checks every one of them — this only keeps the user from being told
	// "409" for something the screen could have greyed out.
	const allDraft =
		selected.length > 0 && selected.every((rule) => rule.status === "draft");
	const allProposed =
		selected.length > 0 && selected.every((rule) => rule.status === "proposed");
	const anyAbandoned = selected.some((rule) => rule.status === "abandoned");

	const chips: Chip[] = (
		["draft", "proposed", "verified", "abandoned"] as RuleStatus[]
	).map((status) => ({
		value: status,
		label: STATUS_LABELS[status],
		count: props.counts[status],
	}));

	const filtered = props.status !== "" || props.query !== "";

	return (
		<>
			<div className="toolbar">
				<FilterChips
					chips={chips}
					active={props.status}
					onChange={(value) => props.onStatusChange(value as RuleStatus | "")}
				/>
				<input
					type="search"
					aria-label="Filter rules by directive"
					placeholder="Filter by directive"
					value={props.query}
					onChange={(event) => props.onQueryChange(event.target.value)}
				/>
				<span className="spacer" />
				{/*
					The selection controls sit here rather than in a footer of their
					own, matching the entries tab. Four chips and three buttons will
					not fit beside them on a narrow window, so they are grouped: the
					set drops to a second line together instead of shedding one
					button at a time.
				*/}
				<div className="toolbar-actions">
					<span className="bulk-count" data-active={selection.size > 0}>
						{selection.size} selected
					</span>
					<button
						type="button"
						className="btn-primary"
						disabled={!allDraft}
						onClick={() => props.onCreatePromotion(selection.ids)}
					>
						Create rules PR ({selection.size})
					</button>
					<button
						type="button"
						disabled={!allProposed}
						onClick={() => props.onVerify(selection.ids)}
					>
						Mark verified
					</button>
					<button
						type="button"
						className="btn-danger"
						disabled={selection.size === 0 || anyAbandoned}
						onClick={() => props.onAbandon(selection.ids)}
					>
						Abandon
					</button>
					{selection.size > 0 && !allDraft && (
						<span className="bulk-hint">Only draft rules can be promoted.</span>
					)}
					{props.error && <span className="bulk-error">{props.error}</span>}
				</div>
			</div>

			<div className="table-wrap">
				{props.loading ? (
					<TableSkeleton />
				) : props.rules.length === 0 ? (
					<TableEmpty
						title={filtered ? "No rules match this filter." : "No rules yet."}
						hint={
							filtered
								? "Clear the filter or widen the search to see the rest."
								: "Analyse some entries and the Dos and Don'ts they contain land here."
						}
					/>
				) : (
					<table>
						<thead>
							<tr>
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
								<th>Kind</th>
								<th>Directive</th>
								<th>Scope</th>
								<th className="num">Confidence</th>
								<th>Source</th>
								<th>Status</th>
							</tr>
						</thead>
						<tbody>
							{props.rules.map((rule) => (
								<tr key={rule.id}>
									<td>
										<input
											type="checkbox"
											aria-label={`Select ${rule.directive}`}
											checked={selection.has(rule.id)}
											onChange={() => selection.toggle(rule)}
										/>
									</td>
									<td>
										<Badge kind={rule.kind}>
											{rule.kind === "do" ? "DO" : "DON'T"}
										</Badge>
									</td>
									<td className="cell-title">
										<button
											type="button"
											className="btn-plain"
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
									<td className="num">{rule.confidence.toFixed(2)}</td>
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
