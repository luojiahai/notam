import { useState } from "react";
import type { RuleStatus } from "../../../src/shared/api.ts";
import { useRules, useSetRuleStatus } from "../api/hooks.ts";
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
	const rules = useRules(repoId, status, query, sort);
	const setRuleStatus = useSetRuleStatus();

	if (rules.error) return <p className="error">{rules.error.message}</p>;

	return (
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
			// Task 16 replaces this with the promotion flow.
			onCreatePromotion={() => {}}
			loading={rules.isPending}
		/>
	);
}
