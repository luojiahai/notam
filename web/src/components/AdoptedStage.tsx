import type { RuleSummary } from "../../../src/shared/api.ts";
import {
	RULE_TYPE_LABELS,
	RULE_TYPES,
} from "../../../src/shared/rule-types.ts";
import { useRules, useSetRuleStatus } from "../api/hooks.ts";
import { day } from "../lib/day.ts";
import { TableEmpty, TableError, TableSkeleton } from "./TableState.tsx";

/**
 * Grouped in the vocabulary's own order, and empty types are dropped. The
 * order is fixed rather than by size so a brief read twice does not reshuffle
 * itself between readings.
 */
function byType(
	rules: RuleSummary[],
): { type: string; rules: RuleSummary[] }[] {
	return RULE_TYPES.map((type) => ({
		type,
		rules: rules.filter((rule) => rule.type === type),
	})).filter((section) => section.rules.length > 0);
}

/**
 * The standing agreements, drawn as the document they become rather than as
 * another table of rows.
 *
 * This is the only stage whose contents leave NOTAM: a verified rule is a file
 * in the repository that coding agents read before they touch it. Rendering it
 * as a scannable grid would be rendering the storage shape; rendering it as a
 * brief shows the reader what the team is actually committed to, in the shape
 * they will meet it in.
 */
export function AdoptedStage({
	repoId,
	repoName,
	onOpenRule,
}: {
	repoId: string;
	repoName: string;
	onOpenRule: (ruleId: string) => void;
}) {
	const rules = useRules(repoId, "verified", "");
	const setRuleStatus = useSetRuleStatus();

	if (rules.error) return <TableError message={rules.error.message} />;

	const adopted = rules.data?.rules ?? [];
	const sections = byType(adopted);

	return (
		<div className="table-wrap">
			{rules.isPending ? (
				<TableSkeleton />
			) : adopted.length === 0 ? (
				<TableEmpty
					title="Nothing adopted yet."
					hint="A rule is adopted once its pull request has landed and you have marked it verified. Adopted rules are never rewritten by a re-analysis."
				/>
			) : (
				<article className="brief">
					<header className="brief-head">
						<h2>The standing brief</h2>
						<p className="brief-sub">
							{adopted.length} agreement{adopted.length === 1 ? "" : "s"} in
							force across <strong>{repoName}</strong>. Re-analysis never
							touches these.
						</p>
						{setRuleStatus.error && (
							<p className="stage-error" role="alert">
								{setRuleStatus.error.message}
							</p>
						)}
					</header>
					{sections.map((section) => (
						<section className="brief-section" key={section.type}>
							<h3>
								{
									RULE_TYPE_LABELS[
										section.type as keyof typeof RULE_TYPE_LABELS
									]
								}
							</h3>
							<ol className="brief-rules">
								{section.rules.map((rule) => (
									<li key={rule.id}>
										<button
											type="button"
											className="btn-plain brief-directive"
											onClick={() => onOpenRule(rule.id)}
										>
											{rule.directive}
										</button>
										<p className="brief-rationale">{rule.rationale}</p>
										<p className="brief-meta">
											<code>
												{rule.scope_globs.length === 0
													? "whole repository"
													: rule.scope_globs.join(", ")}
											</code>
											<span aria-hidden="true"> · </span>
											<a
												href={rule.source_url}
												target="_blank"
												rel="noreferrer"
											>
												#{rule.source_number}
											</a>
											<span aria-hidden="true"> · </span>
											adopted {day(rule.status_changed_at)}
											{/*
												Withdrawing is the one thing that can still happen
												to an adopted rule, so it is the one control here.
												It is a plain, quiet button rather than a checkbox
												column: putting a selection grid over a document
												would turn the brief back into the table this
												stage exists not to be.
											*/}
											<span aria-hidden="true"> · </span>
											<button
												type="button"
												className="btn-plain brief-withdraw"
												onClick={() =>
													setRuleStatus.mutate({
														ruleIds: [rule.id],
														status: "abandoned",
													})
												}
											>
												Withdraw
											</button>
										</p>
									</li>
								))}
							</ol>
						</section>
					))}
				</article>
			)}
		</div>
	);
}
