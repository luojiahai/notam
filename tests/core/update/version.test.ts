import { describe, expect, test } from "bun:test";
import {
	compareVersions,
	parseVersion,
	tagFor,
} from "../../../src/core/update/version.ts";

describe("parseVersion", () => {
	test("accepts a bare version and a v-prefixed tag alike", () => {
		expect(parseVersion("0.1.2")).toEqual([0, 1, 2]);
		expect(parseVersion("v0.1.2")).toEqual([0, 1, 2]);
	});

	test("rejects anything that is not exactly three numbers", () => {
		expect(parseVersion("dev")).toBeNull();
		expect(parseVersion("0.1")).toBeNull();
		expect(parseVersion("0.1.2.3")).toBeNull();
		expect(parseVersion("0.2.0-rc.1")).toBeNull();
		expect(parseVersion("")).toBeNull();
		expect(parseVersion("v")).toBeNull();
	});

	test("reads a zero-padded component as its number", () => {
		expect(parseVersion("0.01.2")).toEqual([0, 1, 2]);
	});
});

describe("compareVersions", () => {
	test("orders by each component in turn", () => {
		expect(compareVersions([0, 1, 2], [0, 1, 3])).toBeLessThan(0);
		expect(compareVersions([0, 2, 0], [0, 1, 9])).toBeGreaterThan(0);
		expect(compareVersions([1, 0, 0], [0, 9, 9])).toBeGreaterThan(0);
		expect(compareVersions([0, 1, 2], [0, 1, 2])).toBe(0);
	});

	test("compares patch numbers numerically, not as text", () => {
		// "0.1.10" sorts before "0.1.9" as a string, which would let an update
		// to 0.1.10 be refused as a downgrade.
		expect(compareVersions([0, 1, 10], [0, 1, 9])).toBeGreaterThan(0);
	});
});

describe("tagFor", () => {
	test("normalises either form onto the v-prefixed tag", () => {
		expect(tagFor("0.1.2")).toBe("v0.1.2");
		expect(tagFor("v0.1.2")).toBe("v0.1.2");
	});
});
