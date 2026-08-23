import { describe, expect, test } from "bun:test";
import { matchedPrefix, matchesGlobs } from "../../../src/core/sync/globs.ts";

describe("matchesGlobs", () => {
	test("keeps everything when there are no globs", () => {
		expect(matchesGlobs(["anything/at/all.ts"], [])).toBe(true);
		expect(matchesGlobs([], [])).toBe(true);
	});

	test("matches a file directly inside a globbed folder", () => {
		expect(
			matchesGlobs(["services/payments/round.ts"], ["services/payments/**"]),
		).toBe(true);
	});

	test("matches a file nested arbitrarily deep", () => {
		expect(
			matchesGlobs(
				["services/payments/api/v2/handler.ts"],
				["services/payments/**"],
			),
		).toBe(true);
	});

	test("rejects a path outside every glob", () => {
		expect(
			matchesGlobs(["services/shipping/rate.ts"], ["services/payments/**"]),
		).toBe(false);
	});

	test("keeps a PR when any one of its paths matches", () => {
		const paths = [
			"docs/README.md",
			"services/payments/round.ts",
			"web/app.tsx",
		];
		expect(matchesGlobs(paths, ["services/payments/**"])).toBe(true);
	});

	test("matches against any one of several globs", () => {
		const globs = ["services/payments/**", "libs/money/**"];
		expect(matchesGlobs(["libs/money/currency.ts"], globs)).toBe(true);
		expect(matchesGlobs(["libs/time/clock.ts"], globs)).toBe(false);
	});

	test("does not match a sibling folder with a shared prefix", () => {
		expect(
			matchesGlobs(["services/payments-legacy/x.ts"], ["services/payments/**"]),
		).toBe(false);
	});

	test("supports an extension glob", () => {
		expect(matchesGlobs(["migrations/003_add_index.sql"], ["**/*.sql"])).toBe(
			true,
		);
		expect(matchesGlobs(["migrations/003_add_index.ts"], ["**/*.sql"])).toBe(
			false,
		);
	});

	test("rejects a PR with no changed paths when globs are set", () => {
		expect(matchesGlobs([], ["services/payments/**"])).toBe(false);
	});
});

describe("matchedPrefix", () => {
	test("returns the first glob that matched, for the UI's secondary line", () => {
		const globs = ["services/payments/**", "libs/money/**"];
		expect(matchedPrefix(["libs/money/currency.ts"], globs)).toBe(
			"libs/money/**",
		);
	});

	test("returns null when nothing matched", () => {
		expect(matchedPrefix(["web/app.tsx"], ["services/payments/**"])).toBeNull();
	});

	test("returns null when there are no globs, because nothing narrowed the sync", () => {
		expect(matchedPrefix(["web/app.tsx"], [])).toBeNull();
	});
});
