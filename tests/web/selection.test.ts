import { describe, expect, test } from "bun:test";
import { selectionReducer } from "../../web/src/state/selection.ts";

type Row = { id: string; label: string };

const a: Row = { id: "a", label: "A" };
const b: Row = { id: "b", label: "B" };
const c: Row = { id: "c", label: "C" };
const empty: ReadonlyMap<string, Row> = new Map();

describe("selectionReducer", () => {
	test("toggle adds then removes", () => {
		const one = selectionReducer(empty, { type: "toggle", row: a });
		expect([...one.keys()]).toEqual(["a"]);
		expect([
			...selectionReducer(one, { type: "toggle", row: a }).keys(),
		]).toEqual([]);
	});

	test("toggle remembers the whole row, not just its id", () => {
		// This is what lets a bulk action answer "how many drafts?" for a
		// selected row the current filter has hidden.
		const one = selectionReducer(empty, { type: "toggle", row: a });
		expect(one.get("a")).toEqual(a);
	});

	test("set replaces the whole selection", () => {
		const some = selectionReducer(empty, { type: "toggle", row: a });
		expect([
			...selectionReducer(some, { type: "set", rows: [b, c] }).keys(),
		]).toEqual(["b", "c"]);
	});

	test("clear on an empty selection returns the same object", () => {
		// Referential stability matters: this value feeds effect dependency
		// arrays, and a fresh empty Map every render would loop.
		expect(selectionReducer(empty, { type: "clear" })).toBe(empty);
	});

	test("clear empties a non-empty selection", () => {
		const some = selectionReducer(empty, { type: "set", rows: [a, b] });
		expect(selectionReducer(some, { type: "clear" }).size).toBe(0);
	});
});
