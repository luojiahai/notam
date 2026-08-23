import { describe, expect, test } from "bun:test";
import {
	MAX_SLUG_LENGTH,
	resolveSlugs,
	slugify,
} from "../../../src/core/rules/slug.ts";

describe("slugify", () => {
	test("kebab-cases a directive", () => {
		expect(slugify("Always add a regression test alongside a bug fix.")).toBe(
			"always-add-a-regression-test-alongside-a-bug-fix",
		);
	});

	test("strips punctuation and collapses separators", () => {
		expect(slugify("Don't log full card numbers — ever!")).toBe(
			"don-t-log-full-card-numbers-ever",
		);
		expect(slugify("use  __snake__  case")).toBe("use-snake-case");
	});

	test("trims leading and trailing separators", () => {
		expect(slugify("  ...leading and trailing...  ")).toBe(
			"leading-and-trailing",
		);
	});

	test("truncates long directives at a word boundary", () => {
		const slug = slugify(
			"Always remember to add a comprehensive regression test alongside every single bug fix you ever ship to production",
		);
		expect(slug.length).toBeLessThanOrEqual(MAX_SLUG_LENGTH);
		expect(slug.endsWith("-")).toBe(false);
		expect(slug.startsWith("always-remember-to-add-a-comprehensive")).toBe(
			true,
		);
	});

	test("falls back to 'rule' when nothing survives", () => {
		expect(slugify("!!!")).toBe("rule");
		expect(slugify("")).toBe("rule");
		expect(slugify("日本語")).toBe("rule");
	});

	test("is stable — the same directive always yields the same slug", () => {
		const directive =
			"Prefer dependency injection over module-level singletons.";
		expect(slugify(directive)).toBe(slugify(directive));
	});
});

describe("resolveSlugs", () => {
	test("leaves a clean batch untouched", () => {
		expect(resolveSlugs(["alpha", "beta"], [])).toEqual([
			{ slug: "alpha", collided: null },
			{ slug: "beta", collided: null },
		]);
	});

	test("suffixes against files already on the base branch", () => {
		expect(resolveSlugs(["alpha"], ["alpha"])).toEqual([
			{ slug: "alpha-2", collided: "base-branch" },
		]);
	});

	test("keeps counting past an existing suffix on the base branch", () => {
		expect(resolveSlugs(["alpha"], ["alpha", "alpha-2"])).toEqual([
			{ slug: "alpha-3", collided: "base-branch" },
		]);
	});

	test("suffixes duplicates within the same batch", () => {
		expect(resolveSlugs(["alpha", "alpha", "alpha"], [])).toEqual([
			{ slug: "alpha", collided: null },
			{ slug: "alpha-2", collided: "batch" },
			{ slug: "alpha-3", collided: "batch" },
		]);
	});

	test("reports the base branch when a rule collides with both", () => {
		expect(resolveSlugs(["alpha", "alpha"], ["alpha"])).toEqual([
			{ slug: "alpha-2", collided: "base-branch" },
			{ slug: "alpha-3", collided: "base-branch" },
		]);
	});

	test("accepts base-branch names with or without the .md extension", () => {
		expect(resolveSlugs(["alpha"], ["alpha.md"])).toEqual([
			{ slug: "alpha-2", collided: "base-branch" },
		]);
	});

	test("an empty batch resolves to an empty list", () => {
		expect(resolveSlugs([], ["alpha"])).toEqual([]);
	});
});
