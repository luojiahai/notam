import { useState } from "react";
import type { PromotionState } from "../../../src/shared/api.ts";
import { usePromotions, useRefreshPromotions } from "../api/hooks.ts";
import { filterPromotions, promotionCounts } from "../lib/promotions.ts";
import { PromotionsTable } from "./PromotionsTable.tsx";
import { TableError } from "./TableState.tsx";

/**
 * Wiring: the fetch, the chip and filter-box state, and the refresh button's
 * mutation.
 *
 * That mutation is owned here rather than by App. Its failure is read in this
 * toolbar and nowhere else, so there is nothing for App to lift.
 */
export function PromotionsTab({ repoId }: { repoId: string }) {
	const [state, setState] = useState<PromotionState | "">("");
	const [query, setQuery] = useState("");
	const promotions = usePromotions(repoId);
	const refresh = useRefreshPromotions();

	if (promotions.error) {
		return <TableError message={promotions.error.message} />;
	}

	const all = promotions.data ?? [];

	return (
		<PromotionsTable
			promotions={filterPromotions(all, state, query)}
			// Counted from the whole list, not the filtered rows: a chip that
			// renumbered itself as you filtered could never take you back.
			counts={promotionCounts(all)}
			state={state}
			onStateChange={setState}
			query={query}
			onQueryChange={setQuery}
			onRefresh={() => refresh.mutate(repoId)}
			refreshing={refresh.isPending}
			loading={promotions.isPending}
			// Verbatim server text: a host that refused the status check says why
			// here and nowhere else.
			error={refresh.error?.message ?? null}
		/>
	);
}
