import type { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { RepoRow } from "../../src/shared/types.ts";
import {
	getPromotion,
	insertPromotion,
	listOpenPromotions,
	listPromotions,
	setPromotionState,
	touchPromotion,
} from "../../src/store/promotions.ts";
import { SEED_NOW, seedDatabase } from "../helpers/seed.ts";

let db: Database;
let repo: RepoRow;

beforeEach(() => {
	const seeded = seedDatabase();
	db = seeded.db;
	repo = seeded.repo;
});
afterEach(() => db.close());

function promotion(branch = "notam/rules-20260823-abc123") {
	return insertPromotion(
		db,
		{
			repo_id: repo.id,
			branch,
			pr_number: 12,
			pr_url: "https://github.com/acme/mono/pull/12",
		},
		SEED_NOW,
	);
}

describe("insertPromotion", () => {
	test("stores an open promotion with a pm_ id", () => {
		const row = promotion();
		expect(row.id.startsWith("pm_")).toBe(true);
		expect(row.state).toBe("open");
		expect(row.pr_number).toBe(12);
		expect(row.pr_url).toBe("https://github.com/acme/mono/pull/12");
		expect(row.created_at).toBe(SEED_NOW.toISOString());
		expect(row.last_checked_at).toBeNull();
	});

	test("accepts a promotion with no PR yet", () => {
		const row = insertPromotion(
			db,
			{
				repo_id: repo.id,
				branch: "notam/rules-x",
				pr_number: null,
				pr_url: null,
			},
			SEED_NOW,
		);
		expect(row.pr_number).toBeNull();
		expect(row.pr_url).toBeNull();
	});
});

describe("reads", () => {
	test("getPromotion round-trips, and returns null for an unknown id", () => {
		const row = promotion();
		expect(getPromotion(db, row.id)).toEqual(row);
		expect(getPromotion(db, "pm_nope")).toBeNull();
	});

	test("listPromotions is newest first and filters by repo", () => {
		const first = promotion("notam/rules-a");
		const second = insertPromotion(
			db,
			{ repo_id: repo.id, branch: "notam/rules-b", pr_number: 13, pr_url: "u" },
			new Date("2026-08-24T09:00:00.000Z"),
		);
		expect(listPromotions(db).map((p) => p.id)).toEqual([second.id, first.id]);
		expect(listPromotions(db, repo.id).map((p) => p.id)).toEqual([
			second.id,
			first.id,
		]);
		expect(listPromotions(db, "r_other")).toEqual([]);
	});

	test("listOpenPromotions excludes merged and closed", () => {
		const open = promotion("notam/rules-open");
		const merged = promotion("notam/rules-merged");
		setPromotionState(db, merged.id, "merged", "2026-08-24T00:00:00.000Z");
		expect(listOpenPromotions(db).map((p) => p.id)).toEqual([open.id]);
	});
});

describe("state changes", () => {
	test("setPromotionState records the state and the check time", () => {
		const row = promotion();
		expect(
			setPromotionState(db, row.id, "merged", "2026-08-24T00:00:00.000Z"),
		).toBe(true);
		const after = getPromotion(db, row.id);
		expect(after?.state).toBe("merged");
		expect(after?.last_checked_at).toBe("2026-08-24T00:00:00.000Z");
	});

	test("setPromotionState reports false for an unknown id", () => {
		expect(
			setPromotionState(db, "pm_nope", "closed", "2026-08-24T00:00:00.000Z"),
		).toBe(false);
	});

	test("touchPromotion records a check that found no change", () => {
		const row = promotion();
		expect(touchPromotion(db, row.id, "2026-08-24T00:00:00.000Z")).toBe(true);
		const after = getPromotion(db, row.id);
		expect(after?.state).toBe("open");
		expect(after?.last_checked_at).toBe("2026-08-24T00:00:00.000Z");
	});
});
