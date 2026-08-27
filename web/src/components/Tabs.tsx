import { useRef } from "react";

export type Tab<Id extends string> = { id: Id; label: string };

/**
 * The id a tab button carries. Exported because the tabpanel names its tab
 * with `aria-labelledby` from outside this file, and a tablist whose panel
 * points at an id nothing renders is silent about what it holds.
 */
export function tabDomId(id: string): string {
	return `tab-${id}`;
}

/**
 * A real tablist rather than a row of buttons wearing the role.
 *
 * The run is one tab stop, not one per tab: the arrows move within it, Home
 * and End reach its ends, and Tab leaves it for the panel below. A tablist
 * that leaves one stop per tab in the sequence is worse than plain buttons,
 * because a screen reader announces arrow keys that do nothing.
 *
 * Selection follows focus, which is the right choice here because switching is
 * free — the panels are already mounted behind a cheap query cache, and
 * requiring Enter after each arrow would make the keyboard path slower than
 * the pointer one for no gain.
 */
export function Tabs<Id extends string>({
	tabs,
	active,
	onChange,
	panelId,
}: {
	tabs: readonly Tab<Id>[];
	active: Id;
	onChange: (id: Id) => void;
	/** The panel this run controls, so each tab can point at it. */
	panelId: string;
}) {
	const list = useRef<HTMLDivElement>(null);

	function move(to: number): void {
		const next = tabs[(to + tabs.length) % tabs.length];
		if (!next) return;
		onChange(next.id);
		// The button is only rendered after the state lands, so focus follows on
		// the element that is already there — the id is stable across renders.
		list.current
			?.querySelector<HTMLButtonElement>(`#${tabDomId(next.id)}`)
			?.focus();
	}

	function onKeyDown(event: React.KeyboardEvent): void {
		const at = tabs.findIndex((tab) => tab.id === active);
		if (event.key === "ArrowRight") move(at + 1);
		else if (event.key === "ArrowLeft") move(at - 1);
		else if (event.key === "Home") move(0);
		else if (event.key === "End") move(tabs.length - 1);
		else return;
		event.preventDefault();
	}

	return (
		<div className="tabs" role="tablist" ref={list} onKeyDown={onKeyDown}>
			{tabs.map((tab) => (
				<button
					key={tab.id}
					id={tabDomId(tab.id)}
					type="button"
					role="tab"
					aria-selected={tab.id === active}
					aria-controls={panelId}
					// The roving part: exactly one tab is in the sequence at a time.
					tabIndex={tab.id === active ? 0 : -1}
					onClick={() => onChange(tab.id)}
				>
					{tab.label}
				</button>
			))}
		</div>
	);
}
