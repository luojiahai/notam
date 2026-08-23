import type { PromotionState } from "../../shared/types.ts";
import { getHost } from "../../store/hosts.ts";
import {
	listOpenPromotions,
	setPromotionState,
	touchPromotion,
} from "../../store/promotions.ts";
import { getRepo } from "../../store/repos.ts";
import { listRulesByPromotion } from "../../store/rules.ts";
import { parseRepoName } from "../github/types.ts";
import { transitionRules } from "../rules/state.ts";
import type { PromotionDeps } from "./index.ts";

export type RefreshEvent = {
	type: "checked";
	promotionId: string;
	state: PromotionState;
};

export type RefreshSummary = {
	checked: number;
	merged: number;
	closed: number;
	unchanged: number;
	returnedToDraft: number;
	errors: { promotionId: string; message: string }[];
};

/**
 * Spec section 7's status refresh. Only `open` promotions are read, so a merged
 * or closed one is never polled again.
 *
 * A merged promotion does NOT verify its rules: verification is always a manual
 * decision (spec section 8). A closed-unmerged one returns its still-`proposed`
 * rules to `draft`; rules the user already moved to `verified` or `abandoned`
 * are left exactly where they are.
 */
export async function refreshPromotions(
	deps: PromotionDeps,
	options: { repoId?: string; onProgress?: (event: RefreshEvent) => void } = {},
): Promise<RefreshSummary> {
	const summary: RefreshSummary = {
		checked: 0,
		merged: 0,
		closed: 0,
		unchanged: 0,
		returnedToDraft: 0,
		errors: [],
	};

	const open = listOpenPromotions(deps.db).filter(
		(promotion) => !options.repoId || promotion.repo_id === options.repoId,
	);

	for (const promotion of open) {
		// A promotion with no PR number never got as far as GitHub; there is
		// nothing to ask about.
		if (promotion.pr_number === null) continue;

		try {
			const repo = getRepo(deps.db, promotion.repo_id);
			if (!repo) throw new Error(`unknown repo ${promotion.repo_id}`);
			const host = getHost(deps.db, repo.host_id);
			if (!host) throw new Error(`unknown host ${repo.host_id}`);

			// One instant for the whole iteration: `checkedAt` and, in the closed
			// branch below, `transitionRules` both carry it, instead of each
			// calling deps.now() separately and risking two different instants.
			const now = deps.now();
			const state = await deps
				.clientFor(host)
				.getPRState(parseRepoName(repo.name), promotion.pr_number);
			const checkedAt = now.toISOString();
			summary.checked++;
			options.onProgress?.({
				type: "checked",
				promotionId: promotion.id,
				state,
			});

			if (state === "merged") {
				setPromotionState(deps.db, promotion.id, "merged", checkedAt);
				summary.merged++;
				continue;
			}

			if (state === "closed") {
				const stranded = listRulesByPromotion(deps.db, promotion.id).filter(
					(rule) => rule.status === "proposed",
				);
				deps.db.transaction(() => {
					setPromotionState(deps.db, promotion.id, "closed", checkedAt);
					transitionRules(
						deps.db,
						stranded.map((rule) => rule.id),
						"draft",
						now,
					);
				})();
				summary.closed++;
				summary.returnedToDraft += stranded.length;
				continue;
			}

			touchPromotion(deps.db, promotion.id, checkedAt);
			summary.unchanged++;
		} catch (error) {
			// One unreachable pull request must not stop the refresh: the whole
			// point is to bring the rest of the board up to date.
			summary.errors.push({
				promotionId: promotion.id,
				message: error instanceof Error ? error.message : String(error),
			});
		}
	}

	return summary;
}
