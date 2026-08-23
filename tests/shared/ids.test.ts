import { describe, expect, test } from "bun:test";
import { newId } from "../../src/shared/ids.ts";

describe("newId", () => {
	test("prefixes the id with the given prefix", () => {
		expect(newId("r")).toStartWith("r_");
	});

	test("produces a fixed-width id", () => {
		expect(newId("e")).toHaveLength(22);
		expect(newId("j")).toHaveLength(22);
	});

	test("sorts lexicographically by creation time", () => {
		const earlier = newId("r", 1_000_000);
		const later = newId("r", 2_000_000);
		expect(earlier < later).toBe(true);
	});

	test("uses Crockford base32 only, so ids are URL and filename safe", () => {
		expect(newId("r")).toMatch(/^r_[0-9A-HJKMNP-TV-Z]{20}$/);
	});

	test("does not collide across many calls at the same instant", () => {
		const ids = new Set(
			Array.from({ length: 5000 }, () => newId("e", 1_700_000_000_000)),
		);
		expect(ids.size).toBe(5000);
	});
});
