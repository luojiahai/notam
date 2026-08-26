import { useState } from "react";
import { useRules, useSetRuleStatus } from "../api/hooks.ts";
import { PromotionFlow } from "./PromotionFlow.tsx";
import { RulesTable } from "./RulesTable.tsx";
import { TableError } from "./TableState.tsx";

/**
 * The two stages that are a plain list of rules: the drafts waiting on a
 * decision, and the ones the decision went against.
 *
 * They share a component because they differ in exactly one thing — whether
 * the rules can still move. `abandoned` is terminal in the state machine, so
 * that stage renders with no selection and no actions at all rather than with
 * a column of controls that every press would be refused.
 */
export function RulesStage({
	repoId,
	status,
	onOpenRule,
	onPromoted,
}: {
	repoId: string;
	status: "draft" | "abandoned";
	onOpenRule: (ruleId: string) => void;
	onPromoted: () => void;
}) {
	const [query, setQuery] = useState("");
	const [promoting, setPromoting] = useState<string[] | null>(null);
	const rules = useRules(repoId, status, query);
	const setRuleStatus = useSetRuleStatus();

	if (rules.error) return <TableError message={rules.error.message} />;

	const searching = query !== "";
	const empty =
		status === "draft"
			? {
					title: searching ? "No drafts match this filter." : "No drafts.",
					hint: searching
						? "Clear the filter or widen the search to see the rest."
						: "Mine some sources and the agreements they contain land here for you to judge.",
				}
			: {
					title: searching
						? "Nothing set aside matches this filter."
						: "Nothing set aside.",
					hint: searching
						? "Clear the filter or widen the search to see the rest."
						: "Rules you abandon are kept here as a record of the decision. Nothing is ever deleted.",
				};

	return (
		<>
			<RulesTable
				rules={rules.data?.rules ?? []}
				query={query}
				onQueryChange={setQuery}
				onOpenRule={onOpenRule}
				selection={
					status === "draft"
						? {
								onAbandon: (ruleIds) =>
									setRuleStatus.mutate({ ruleIds, status: "abandoned" }),
								onCreatePromotion: (ruleIds) => setPromoting(ruleIds),
							}
						: undefined
				}
				loading={rules.isPending}
				emptyTitle={empty.title}
				emptyHint={empty.hint}
				// Verbatim server text — a 409 from an illegal transition is
				// exactly the message the user needs, and nothing else renders it.
				error={setRuleStatus.error?.message ?? null}
			/>
			{promoting && (
				<PromotionFlow
					ruleIds={promoting}
					onClose={() => setPromoting(null)}
					onPromoted={onPromoted}
				/>
			)}
		</>
	);
}
