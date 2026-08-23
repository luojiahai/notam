import { useEffect } from "react";

/**
 * Escape closes the topmost overlay, and only the topmost.
 *
 * A covering surface with no keyboard exit is a trap, so both the drawer and
 * the dialog want this. But they nest: the re-analyse confirmation opens on top
 * of an entry drawer, and two independent `document` listeners would both fire
 * for one keypress and close both surfaces at once.
 *
 * So the handlers form a stack instead. Mounting pushes, unmounting pops, and
 * one shared listener dispatches to the last entry — which is the innermost
 * overlay, because React mounts children after parents. Relying on listener
 * registration order would have given exactly the wrong answer: the drawer
 * registers first, so it would have won over the dialog sitting on top of it.
 */
const handlers: (() => void)[] = [];
let listening = false;

function onKeyDown(event: KeyboardEvent): void {
	if (event.key !== "Escape" || event.defaultPrevented) return;
	const top = handlers.at(-1);
	if (!top) return;
	event.preventDefault();
	top();
}

export function useDismissOnEscape(onDismiss: () => void): void {
	useEffect(() => {
		handlers.push(onDismiss);
		if (!listening) {
			document.addEventListener("keydown", onKeyDown);
			listening = true;
		}
		return () => {
			// Removed by identity, not by popping: React's strict-mode double
			// invoke and any out-of-order teardown must not shuffle the stack.
			const index = handlers.lastIndexOf(onDismiss);
			if (index !== -1) handlers.splice(index, 1);
			if (handlers.length === 0 && listening) {
				document.removeEventListener("keydown", onKeyDown);
				listening = false;
			}
		};
	}, [onDismiss]);
}
