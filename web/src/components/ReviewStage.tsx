import { RefreshCw } from "lucide-react";
import { useState } from "react";
import type { RuleSummary } from "../../../src/shared/api.ts";
import {
	usePromotions,
	useRefreshPromotions,
	useRules,
	useSetRuleStatus,
} from "../api/hooks.ts";
import { day } from "../lib/day.ts";
import { groupByPromotion, settledPromotions } from "../lib/review.ts";
import { useSelection } from "../state/selection.ts";
import { Badge, StatusPill } from "./Badge.tsx";
import { TableEmpty, TableError, TableSkeleton } from "./TableState.tsx";

export function ReviewStage({
	repoId,
	onOpenRule,
}: {
	repoId: string;
	onOpenRule: (ruleId: string) => void;
}) {
	const promotions = usePromotions(repoId);
	const rules = useRules(repoId, "proposed", "");
	const refresh = useRefreshPromotions();
	const setRuleStatus = useSetRuleStatus();
	const selection = useSelection<RuleSummary>();
	const [showHistory, setShowHistory] = useState(false);

	if (promotions.error)
		return <TableError message={promotions.error.message} />;
	if (rules.error) return <TableError message={rules.error.message} />;

	const loading = promotions.isPending || rules.isPending;
	const all = promotions.data ?? [];
	const groups = groupByPromotion(all, rules.data?.rules ?? []);
	const history = settledPromotions(all);
	const error = refresh.error?.message ?? setRuleStatus.error?.message ?? null;

	return (
		<>
			<div className="toolbar">
				<div className="toolbar-actions">
					<span className="bulk-count" data-active={selection.size > 0}>
						{selection.size} selected
					</span>
					{/*
						Verifying is the act this stage exists for: it is what turns a
						pull request somebody merged into a rule NOTAM will never
						rewrite. Abandon sits beside it because the other answer to
						"did this land" is "we changed our minds".
					*/}
					<button
						type="button"
						className="btn-primary"
						disabled={selection.size === 0}
						onClick={() => {
							setRuleStatus.mutate({
								ruleIds: selection.ids,
								status: "verified",
							});
							selection.clear();
						}}
					>
						Mark verified ({selection.size})
					</button>
					<button
						type="button"
						className="btn-danger"
						disabled={selection.size === 0}
						onClick={() => {
							setRuleStatus.mutate({
								ruleIds: selection.ids,
								status: "abandoned",
							});
							selection.clear();
						}}
					>
						Abandon
					</button>
				</div>
				<span className="spacer" />
				<button
					type="button"
					aria-busy={refresh.isPending}
					disabled={refresh.isPending}
					data-busy={refresh.isPending}
					onClick={() => refresh.mutate(repoId)}
				>
					<RefreshCw className="icon" aria-hidden="true" />
					Refresh status
				</button>
			</div>
			{error && (
				<div className="stage-error" role="alert">
					{error}
				</div>
			)}

			<div className="table-wrap">
				{loading ? (
					<TableSkeleton />
				) : groups.length === 0 ? (
					<TableEmpty
						title="Nothing in review."
						hint="Select draft rules and create a rules pull request; it and the rules riding in it appear here until they land."
					/>
				) : (
					<div className="review">
						{groups.map(({ promotion, rules: carried }) => (
							<section className="promotion" key={promotion.id}>
								<header className="promotion-head">
									<div className="promotion-id">
										{promotion.pr_url && promotion.pr_number !== null ? (
											<a
												className="promotion-number"
												href={promotion.pr_url}
												target="_blank"
												rel="noreferrer"
											>
												#{promotion.pr_number}
											</a>
										) : (
											// A branch is written before the pull request exists,
											// so this heading has to read without one.
											<span className="promotion-number">no pull request</span>
										)}
										<StatusPill status={promotion.state} />
									</div>
									{/* In full: a truncated branch is not one anyone can check out. */}
									<code className="promotion-branch">{promotion.branch}</code>
									<span className="spacer" />
									<span className="promotion-meta">
										opened {day(promotion.created_at)}
										{" · checked "}
										{day(promotion.last_checked_at) ?? "never"}
									</span>
								</header>
								{carried.length === 0 ? (
									<p className="promotion-empty">
										No rules are still riding in this pull request.
									</p>
								) : (
									<ul className="carried">
										{carried.map((rule) => (
											<li key={rule.id}>
												<label className="carried-select">
													<input
														type="checkbox"
														aria-label={`Select ${rule.directive}`}
														checked={selection.has(rule.id)}
														onChange={() => selection.toggle(rule)}
													/>
												</label>
												<Badge>{rule.type}</Badge>
												<div className="carried-body">
													<button
														type="button"
														className="btn-plain cell-directive"
														onClick={() => onOpenRule(rule.id)}
													>
														{rule.directive}
													</button>
													<div className="secondary mono">
														{rule.scope_globs.length === 0
															? "whole repository"
															: rule.scope_globs.join(", ")}
													</div>
												</div>
											</li>
										))}
									</ul>
								)}
							</section>
						))}

						{history.length > 0 && (
							<section className="history">
								<button
									type="button"
									className="btn-plain history-toggle"
									aria-expanded={showHistory}
									onClick={() => setShowHistory((open) => !open)}
								>
									{showHistory ? "Hide" : "Show"} {history.length} settled pull
									request{history.length === 1 ? "" : "s"}
								</button>
								{showHistory && (
									<ul className="history-list">
										{history.map((promotion) => (
											<li key={promotion.id}>
												{promotion.pr_url && promotion.pr_number !== null ? (
													<a
														className="mono"
														href={promotion.pr_url}
														target="_blank"
														rel="noreferrer"
													>
														#{promotion.pr_number}
													</a>
												) : (
													<span className="mono faint">no pull request</span>
												)}
												<StatusPill status={promotion.state} />
												<code className="promotion-branch">
													{promotion.branch}
												</code>
												<span className="spacer" />
												<span className="promotion-meta">
													{promotion.rule_count} rule
													{promotion.rule_count === 1 ? "" : "s"} ·{" "}
													{day(promotion.created_at)}
												</span>
											</li>
										))}
									</ul>
								)}
							</section>
						)}
					</div>
				)}
			</div>
		</>
	);
}
