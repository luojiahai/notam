import { describe, expect, test } from "bun:test";
import { selectionReducer } from "../../web/src/state/selection.ts";

const empty: ReadonlySet<string> = new Set();

describe("selectionReducer", () => {
	test("toggle adds then removes", () => {
		const one = selectionReducer(empty, { type: "toggle", id: "a" });
		expect([...one]).toEqual(["a"]);
		expect([...selectionReducer(one, { type: "toggle", id: "a" })]).toEqual([]);
	});

	test("set replaces the whole selection", () => {
		const some = selectionReducer(empty, { type: "toggle", id: "a" });
		expect([
			...selectionReducer(some, { type: "set", ids: ["b", "c"] }),
		]).toEqual(["b", "c"]);
	});

	test("clear on an empty selection returns the same object", () => {
		// Referential stability matters: this value feeds effect dependency
		// arrays, and a fresh empty Set every render would loop.
		expect(selectionReducer(empty, { type: "clear" })).toBe(empty);
	});

	test("clear empties a non-empty selection", () => {
		const some = selectionReducer(empty, { type: "set", ids: ["a", "b"] });
		expect(selectionReducer(some, { type: "clear" }).size).toBe(0);
	});
});
