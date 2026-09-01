import { useState } from "react";
import type { RuleStatus } from "../../../src/shared/api.ts";
import { useDeleteRules, useRules, useSetRuleStatus } from "../api/hooks.ts";
import { PromotionFlow } from "./PromotionFlow.tsx";
import { RulesTable } from "./RulesTable.tsx";
import { TableError } from "./TableState.tsx";

export function RulesTab({
	repoId,
	onOpenRule,
	onPromoted,
}: {
	repoId: string;
	onOpenRule: (ruleId: string) => void;
	onPromoted: () => void;
}) {
	const [status, setStatus] = useState<RuleStatus | "">("");
	const [query, setQuery] = useState("");
	const [promoting, setPromoting] = useState<string[] | null>(null);
	const rules = useRules(repoId, status, query);
	const setRuleStatus = useSetRuleStatus();
	const deleteRules = useDeleteRules();

	// Two mutations share the one error slot in the bulk bar, so the one pressed
	// most recently owns it: a failure left over from the other would otherwise
	// mask the answer to what the user just did.
	const lastError =
		deleteRules.submittedAt > setRuleStatus.submittedAt
			? deleteRules.error
			: setRuleStatus.error;

	if (rules.error) return <TableError message={rules.error.message} />;

	return (
		<>
			<RulesTable
				rules={rules.data?.rules ?? []}
				counts={
					rules.data?.counts ?? {
						total: 0,
						draft: 0,
						proposed: 0,
						verified: 0,
						abandoned: 0,
					}
				}
				status={status}
				onStatusChange={setStatus}
				query={query}
				onQueryChange={setQuery}
				onOpenRule={onOpenRule}
				onAbandon={(ruleIds) =>
					setRuleStatus.mutate({ ruleIds, status: "abandoned" })
				}
				onVerify={(ruleIds) =>
					setRuleStatus.mutate({ ruleIds, status: "verified" })
				}
				onDelete={(ruleIds) => deleteRules.mutate(ruleIds)}
				onCreatePromotion={(ruleIds) => setPromoting(ruleIds)}
				loading={rules.isPending}
				// Verbatim server text — a 409 from an illegal transition or a
				// refused deletion is exactly the message the user needs, and
				// nothing else renders it.
				error={lastError?.message ?? null}
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
