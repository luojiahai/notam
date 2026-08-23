import { useState } from "react";
import type { RuleStatus } from "../../../src/shared/api.ts";
import { useRules, useSetRuleStatus } from "../api/hooks.ts";
import { PromotionFlow } from "./PromotionFlow.tsx";
import { RulesTable } from "./RulesTable.tsx";

export function RulesTab({
	repoId,
	onOpenRule,
}: {
	repoId: string;
	onOpenRule: (ruleId: string) => void;
}) {
	const [status, setStatus] = useState<RuleStatus | "">("");
	const [query, setQuery] = useState("");
	const [sort, setSort] = useState<"created" | "directive">("created");
	const [promoting, setPromoting] = useState<string[] | null>(null);
	const rules = useRules(repoId, status, query, sort);
	const setRuleStatus = useSetRuleStatus();

	if (rules.error) return <p className="error">{rules.error.message}</p>;

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
				sort={sort}
				onSortChange={setSort}
				onOpenRule={onOpenRule}
				onAbandon={(ruleIds) =>
					setRuleStatus.mutate({ ruleIds, status: "abandoned" })
				}
				onVerify={(ruleIds) =>
					setRuleStatus.mutate({ ruleIds, status: "verified" })
				}
				onCreatePromotion={(ruleIds) => setPromoting(ruleIds)}
				loading={rules.isPending}
				// Verbatim server text — a 409 from an illegal transition is
				// exactly the message the user needs, and nothing else renders it.
				error={setRuleStatus.error?.message ?? null}
			/>
			{promoting && (
				<PromotionFlow ruleIds={promoting} onClose={() => setPromoting(null)} />
			)}
		</>
	);
}
