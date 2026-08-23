import type { Database } from "bun:sqlite";
import { newId } from "../shared/ids.ts";
import type { PromotionRow, PromotionState } from "../shared/types.ts";

type RawPromotion = Omit<PromotionRow, "state"> & { state: string };

function hydrate(raw: RawPromotion): PromotionRow {
	return { ...raw, state: raw.state as PromotionState };
}

export type NewPromotion = {
	repo_id: string;
	branch: string;
	pr_number: number | null;
	pr_url: string | null;
};

/**
 * A promotion row is written only after GitHub has accepted the pull request,
 * so `state` starts at 'open' and `pr_number` is already known in practice —
 * the nullable columns exist so a future resumable promotion can record a branch
 * before its PR.
 */
export function insertPromotion(
	db: Database,
	input: NewPromotion,
	now: Date,
): PromotionRow {
	const id = newId("pm", now.getTime());
	db.query(
		`INSERT INTO promotions (id, repo_id, branch, pr_number, pr_url, state, created_at)
		 VALUES ($id, $repo_id, $branch, $pr_number, $pr_url, 'open', $created_at)`,
	).run({
		$id: id,
		$repo_id: input.repo_id,
		$branch: input.branch,
		$pr_number: input.pr_number,
		$pr_url: input.pr_url,
		$created_at: now.toISOString(),
	});
	const row = getPromotion(db, id);
	if (!row) throw new Error(`promotion ${id} vanished after insert`);
	return row;
}

export function getPromotion(db: Database, id: string): PromotionRow | null {
	const raw = db
		.query<RawPromotion, [string]>("SELECT * FROM promotions WHERE id = ?")
		.get(id);
	return raw ? hydrate(raw) : null;
}

export function listPromotions(db: Database, repoId?: string): PromotionRow[] {
	const rows = repoId
		? db
				.query<RawPromotion, [string]>(
					"SELECT * FROM promotions WHERE repo_id = ? ORDER BY created_at DESC, id DESC",
				)
				.all(repoId)
		: db
				.query<RawPromotion, []>(
					"SELECT * FROM promotions ORDER BY created_at DESC, id DESC",
				)
				.all();
	return rows.map(hydrate);
}

export function listOpenPromotions(db: Database): PromotionRow[] {
	return db
		.query<RawPromotion, []>(
			"SELECT * FROM promotions WHERE state = 'open' ORDER BY created_at, id",
		)
		.all()
		.map(hydrate);
}

export function setPromotionState(
	db: Database,
	id: string,
	state: PromotionState,
	checkedAt: string,
): boolean {
	return (
		db
			.query(
				"UPDATE promotions SET state = ?, last_checked_at = ? WHERE id = ?",
			)
			.run(state, checkedAt, id).changes > 0
	);
}

/** Records that we checked and nothing had changed. */
export function touchPromotion(
	db: Database,
	id: string,
	checkedAt: string,
): boolean {
	return (
		db
			.query("UPDATE promotions SET last_checked_at = ? WHERE id = ?")
			.run(checkedAt, id).changes > 0
	);
}
