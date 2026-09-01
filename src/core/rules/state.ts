import type { Database } from "bun:sqlite";
import type { RuleRow, RuleStatus } from "../../shared/types.ts";
import {
	deleteRulesByIds,
	getRule,
	updateRuleStatus,
} from "../../store/rules.ts";

/**
 * `abandoned` is reachable from anywhere and is terminal: it
 * records a decision the user made, and un-deciding it is not a transition but
 * a fresh analysis.
 *
 * This table is the whole state machine. Nothing else in NOTAM may write
 * `rules.status`.
 */
export const LEGAL_TRANSITIONS: Record<RuleStatus, readonly RuleStatus[]> = {
	draft: ["proposed", "abandoned"],
	proposed: ["draft", "verified", "abandoned"],
	verified: ["abandoned"],
	abandoned: [],
};

export class RuleLifecycleError extends Error {
	override name = "RuleLifecycleError";
}

/** A same-state move is not a transition; callers that want idempotence must check first. */
export function canTransition(from: RuleStatus, to: RuleStatus): boolean {
	return LEGAL_TRANSITIONS[from].includes(to);
}

/**
 * `promotionId` is required for draft -> proposed, because a `proposed` rule
 * with no promotion is a rule the status refresh can never bring home.
 * proposed -> draft clears it for the same reason. verified and abandoned keep
 * whatever link the rule had, as provenance.
 */
function promotionLinkFor(
	to: RuleStatus,
	options: { promotionId?: string } | undefined,
	ruleId: string,
): string | null | undefined {
	if (to === "proposed") {
		if (!options?.promotionId) {
			throw new RuleLifecycleError(
				`rule ${ruleId} cannot become proposed without a promotion id`,
			);
		}
		return options.promotionId;
	}
	if (to === "draft") return null;
	return undefined;
}

function transitionWithin(
	db: Database,
	ruleId: string,
	to: RuleStatus,
	now: Date,
	options?: { promotionId?: string },
): RuleRow {
	const rule = getRule(db, ruleId);
	if (!rule) throw new RuleLifecycleError(`no rule with id ${ruleId}`);
	if (!canTransition(rule.status, to)) {
		throw new RuleLifecycleError(
			`rule ${ruleId} cannot move from ${rule.status} to ${to}`,
		);
	}
	const link = promotionLinkFor(to, options, ruleId);
	updateRuleStatus(db, ruleId, to, link, now.toISOString());
	const after = getRule(db, ruleId);
	if (!after)
		throw new RuleLifecycleError(`rule ${ruleId} vanished mid-transition`);
	return after;
}

export function transitionRule(
	db: Database,
	ruleId: string,
	to: RuleStatus,
	now: Date,
	options?: { promotionId?: string },
): RuleRow {
	return db.transaction(() => transitionWithin(db, ruleId, to, now, options))();
}

/** All or nothing: one illegal rule rolls the whole selection back. */
export function transitionRules(
	db: Database,
	ruleIds: string[],
	to: RuleStatus,
	now: Date,
	options?: { promotionId?: string },
): RuleRow[] {
	if (ruleIds.length === 0) return [];
	return db.transaction(() =>
		ruleIds.map((id) => transitionWithin(db, id, to, now, options)),
	)();
}

/**
 * Destroying a rule is a second, deliberate act on one already parked, so only
 * an `abandoned` rule may go: it is the status nothing follows, and therefore
 * the only one where deleting interrupts nothing.
 *
 * The forgetting is total — no tombstone and no audit row. A promotion the rule
 * belonged to keeps its own row even when that empties it, because its pull
 * request was opened on GitHub whatever became of the rules that went into it.
 *
 * All or nothing, like `transitionRules`: one rule that may not go takes the
 * whole selection with it.
 */
export function deleteRules(db: Database, ruleIds: string[]): RuleRow[] {
	if (ruleIds.length === 0) return [];
	return db.transaction(() => {
		const rows = ruleIds.map((id) => {
			const rule = getRule(db, id);
			if (!rule) throw new RuleLifecycleError(`no rule with id ${id}`);
			if (rule.status !== "abandoned") {
				throw new RuleLifecycleError(
					`rule ${id} is ${rule.status}, and only an abandoned rule can be deleted`,
				);
			}
			return rule;
		});
		deleteRulesByIds(
			db,
			rows.map((rule) => rule.id),
		);
		return rows;
	})();
}
