import { useEffect } from "react";
import type {
	RuleCounts,
	RuleStatus,
	RuleSummary,
} from "../../../src/shared/api.ts";
import { useSelection } from "../state/selection.ts";
import { Badge } from "./Badge.tsx";
import { type Chip, FilterChips } from "./FilterChips.tsx";

export type RulesTableProps = {
	rules: RuleSummary[];
	counts: RuleCounts;
	status: RuleStatus | "";
	onStatusChange: (status: RuleStatus | "") => void;
	query: string;
	onQueryChange: (query: string) => void;
	sort: "created" | "directive";
	onSortChange: (sort: "created" | "directive") => void;
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

	// A selection must never outlive the row set it was made in. The chip, the
	// search box, and the sort all change which rows exist, and `clear` is
	// stable, so this fires exactly on a context change — the repository switch
	// is covered by App keying the tab on `repoId`.
	const { clear } = selection;
	// biome-ignore lint/correctness/useExhaustiveDependencies: the context props are the trigger, not values the effect reads; `clear` is a stable useCallback.
	useEffect(() => {
		clear();
	}, [props.status, props.query, props.sort]);

	// The whole selection, not the visible slice: a rule the current filter
	// hides is still going to be sent, so it still has to be able to veto a
	// bulk action. Visible rows are taken fresh in case a refetch moved them.
	const visible = new Map(props.rules.map((rule) => [rule.id, rule]));
	const selected = selection.rows.map((rule) => visible.get(rule.id) ?? rule);

	// The button states encode spec section 8's state machine. The server
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
				<button
					type="button"
					aria-pressed={props.sort === "directive"}
					onClick={() =>
						props.onSortChange(
							props.sort === "directive" ? "created" : "directive",
						)
					}
				>
					Sort by directive
				</button>
			</div>

			<div className="table-wrap">
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
							<th>Confidence</th>
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
								<td>
									<button
										type="button"
										style={{
											background: "none",
											border: 0,
											padding: 0,
											textAlign: "left",
										}}
										onClick={() => props.onOpenRule(rule.id)}
									>
										{rule.directive}
									</button>
									<div className="secondary">{rule.rationale}</div>
								</td>
								<td className="secondary">
									{rule.scope_globs.length === 0
										? "whole repository"
										: rule.scope_globs.join(", ")}
								</td>
								<td>{rule.confidence.toFixed(2)}</td>
								<td>
									<a href={rule.source_url} target="_blank" rel="noreferrer">
										#{rule.source_number}
									</a>
								</td>
								<td>{rule.status}</td>
							</tr>
						))}
					</tbody>
				</table>
				{props.loading && <p className="secondary">Loading…</p>}
				{!props.loading && props.rules.length === 0 && (
					<p className="secondary">No rules match this filter.</p>
				)}
			</div>

			<div className="bulk">
				<span>{selection.size} selected</span>
				<button
					type="button"
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
					disabled={selection.size === 0 || anyAbandoned}
					onClick={() => props.onAbandon(selection.ids)}
				>
					Abandon
				</button>
				{selection.size > 0 && !allDraft && (
					<span className="secondary">Only draft rules can be promoted.</span>
				)}
				{props.error && <span className="error">{props.error}</span>}
			</div>
		</>
	);
}
