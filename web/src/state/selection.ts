import { useCallback, useMemo, useReducer } from "react";

/** Anything a table can select: the id is the key, the row is what is remembered. */
export type SelectionRow = { id: string };

export type SelectionAction<T extends SelectionRow> =
	| { type: "toggle"; row: T }
	| { type: "set"; rows: readonly T[] }
	| { type: "clear" };

/**
 * Pure, and exported for its own test: the entries table and the rules table
 * both lean on it, and a selection bug shows up as an irreversible transition
 * applied to a row the user cannot see.
 *
 * The whole selected *row* is kept, not just its id. A table only ever renders
 * the slice that matches the current filter, so deriving "how many drafts is
 * this about to discard" or "are these all drafts" from the visible rows
 * silently under-reports as soon as a selected row scrolls out of the filter.
 * Remembering the row makes those answers depend on the selection itself.
 */
export function selectionReducer<T extends SelectionRow>(
	state: ReadonlyMap<string, T>,
	action: SelectionAction<T>,
): ReadonlyMap<string, T> {
	switch (action.type) {
		case "toggle": {
			const next = new Map(state);
			if (!next.delete(action.row.id)) next.set(action.row.id, action.row);
			return next;
		}
		case "set":
			return new Map(action.rows.map((row) => [row.id, row]));
		case "clear":
			// Same object when already empty, so effects that depend on the
			// selection do not re-fire on every unrelated render.
			return state.size === 0 ? state : new Map<string, T>();
	}
}

export type Selection<T extends SelectionRow> = {
	/** Selection order, which is the order every bulk action is sent in. */
	ids: string[];
	rows: T[];
	size: number;
	has: (id: string) => boolean;
	get: (id: string) => T | undefined;
	toggle: (row: T) => void;
	setAll: (rows: readonly T[]) => void;
	clear: () => void;
};

export function useSelection<T extends SelectionRow>(): Selection<T> {
	const [byId, dispatch] = useReducer(
		selectionReducer<T>,
		undefined,
		() => new Map<string, T>() as ReadonlyMap<string, T>,
	);
	const has = useCallback((id: string) => byId.has(id), [byId]);
	const get = useCallback((id: string) => byId.get(id), [byId]);
	const toggle = useCallback((row: T) => dispatch({ type: "toggle", row }), []);
	const setAll = useCallback(
		(rows: readonly T[]) => dispatch({ type: "set", rows }),
		[],
	);
	const clear = useCallback(() => dispatch({ type: "clear" }), []);
	return useMemo(
		() => ({
			ids: [...byId.keys()],
			rows: [...byId.values()],
			size: byId.size,
			has,
			get,
			toggle,
			setAll,
			clear,
		}),
		[byId, has, get, toggle, setAll, clear],
	);
}
