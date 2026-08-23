import { useCallback, useMemo, useReducer } from "react";

export type SelectionAction =
	| { type: "toggle"; id: string }
	| { type: "set"; ids: string[] }
	| { type: "clear" };

/**
 * Pure, and exported for its own test: the entries table, the rules table, and
 * the promotion dialog all lean on it, and a selection bug shows up as a
 * promotion committing the wrong files.
 */
export function selectionReducer(
	state: ReadonlySet<string>,
	action: SelectionAction,
): ReadonlySet<string> {
	switch (action.type) {
		case "toggle": {
			const next = new Set(state);
			if (!next.delete(action.id)) next.add(action.id);
			return next;
		}
		case "set":
			return new Set(action.ids);
		case "clear":
			// Same object when already empty, so effects that depend on the
			// selection do not re-fire on every unrelated render.
			return state.size === 0 ? state : new Set<string>();
	}
}

export type Selection = {
	ids: ReadonlySet<string>;
	size: number;
	has: (id: string) => boolean;
	toggle: (id: string) => void;
	setAll: (ids: string[]) => void;
	clear: () => void;
};

export function useSelection(): Selection {
	const [ids, dispatch] = useReducer(
		selectionReducer,
		undefined,
		() => new Set<string>() as ReadonlySet<string>,
	);
	const has = useCallback((id: string) => ids.has(id), [ids]);
	const toggle = useCallback(
		(id: string) => dispatch({ type: "toggle", id }),
		[],
	);
	const setAll = useCallback(
		(next: string[]) => dispatch({ type: "set", ids: next }),
		[],
	);
	const clear = useCallback(() => dispatch({ type: "clear" }), []);
	return useMemo(
		() => ({ ids, size: ids.size, has, toggle, setAll, clear }),
		[ids, has, toggle, setAll, clear],
	);
}
