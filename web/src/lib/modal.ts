import type { MouseEvent, PointerEvent, RefObject } from "react";
import { useCallback, useEffect, useRef } from "react";
import { useDismissOnEscape } from "./dismiss.ts";

/**
 * What a modal surface owes the keyboard.
 *
 * `aria-modal="true"` is a promise that the rest of the page is unreachable
 * while the surface is up. Nothing enforces that on its own, so this does the
 * three things that make the promise true: focus moves in on open, Tab cannot
 * leave, and the control that opened the surface gets focus back when it
 * closes. Without the third, dismissing drops focus on `<body>` and the next
 * Tab restarts from the top of the document.
 */

/**
 * Deliberately unfiltered by visibility. Every control inside an overlay in
 * this app is rendered because it is meant to be used, and the geometry checks
 * that would filter a hidden one (`offsetParent`, `getClientRects`) report
 * nothing in a headless DOM — a trap that silently disengages under test is
 * worse than one that occasionally includes a control it did not need to.
 */
const FOCUSABLE = [
	"a[href]",
	"button:not(:disabled)",
	"input:not(:disabled)",
	"select:not(:disabled)",
	"textarea:not(:disabled)",
	'[tabindex]:not([tabindex="-1"])',
].join(",");

function focusableWithin(container: HTMLElement): HTMLElement[] {
	return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE));
}

/**
 * Moves focus into `container` on mount, keeps Tab inside it, and returns
 * focus to whatever had it on the way out.
 *
 * The container itself is the fallback target, which is why it needs
 * `tabIndex={-1}`: a surface can open with nothing focusable in it at all —
 * a rule still loading, a plan still being checked — and focus left outside a
 * surface claiming modality is the exact state this hook exists to prevent.
 */
export function useModalFocus(container: RefObject<HTMLElement | null>): void {
	useEffect(() => {
		const element = container.current;
		if (!element) return;

		const restoreTo = document.activeElement;
		const first = focusableWithin(element)[0] ?? element;
		first.focus();

		function onKeyDown(event: KeyboardEvent): void {
			if (event.key !== "Tab" || !element) return;
			const stops = focusableWithin(element);
			// Nothing to cycle between: hold focus where it is rather than
			// letting Tab walk out into a page that is supposed to be inert.
			if (stops.length === 0) {
				event.preventDefault();
				return;
			}
			const firstStop = stops[0];
			const lastStop = stops[stops.length - 1];
			if (!firstStop || !lastStop) return;
			if (event.shiftKey && document.activeElement === firstStop) {
				event.preventDefault();
				lastStop.focus();
			} else if (!event.shiftKey && document.activeElement === lastStop) {
				event.preventDefault();
				firstStop.focus();
			}
		}

		element.addEventListener("keydown", onKeyDown);
		return () => {
			element.removeEventListener("keydown", onKeyDown);
			// Only if it is still on screen: the row that opened a panel can be
			// gone by the time the panel closes, and focusing a detached node
			// silently drops focus on `<body>`.
			if (
				restoreTo instanceof HTMLElement &&
				restoreTo.isConnected &&
				typeof restoreTo.focus === "function"
			) {
				restoreTo.focus();
			}
		};
	}, [container]);
}

/**
 * Click-outside-to-dismiss, for a backdrop that is the overlay's own parent
 * element.
 *
 * Both ends of the click have to land on the backdrop. Selecting text inside a
 * dialog and releasing the button past its edge is one `click` event whose
 * target is the backdrop, and treating that as a dismissal throws away
 * whatever the user was in the middle of — which, on the promotion pre-flight,
 * is a set of checkboxes decided one file at a time.
 */
export function useBackdropDismiss(onDismiss: () => void): {
	onPointerDown: (event: PointerEvent) => void;
	onClick: (event: MouseEvent) => void;
} {
	// A ref rather than a closure variable: the press and the release are two
	// events with a render between them often enough — a re-plan, an SSE tick —
	// and a value held in the function body would not survive it.
	const armed = useRef(false);
	const onPointerDown = useCallback((event: PointerEvent) => {
		armed.current = event.target === event.currentTarget;
	}, []);
	const onClick = useCallback(
		(event: MouseEvent) => {
			if (armed.current && event.target === event.currentTarget) onDismiss();
			armed.current = false;
		},
		[onDismiss],
	);
	return { onPointerDown, onClick };
}

/**
 * The whole of what a window owes, assembled once.
 *
 * Focus in on open and held inside, Escape out, a click beside it out — the
 * three are one contract, not three choices a surface makes separately. A
 * chassis that wired two of the three would look correct in the markup and be
 * the one window in the app that behaves differently, which is precisely the
 * failure `aria-modal` invites. Callers supply the ref to their own surface
 * element and spread `backdrop` on the overlay that wraps it.
 */
export function useModalSurface(onDismiss: () => void): {
	surface: RefObject<HTMLDivElement | null>;
	backdrop: ReturnType<typeof useBackdropDismiss>;
} {
	const surface = useRef<HTMLDivElement>(null);
	useDismissOnEscape(onDismiss);
	useModalFocus(surface);
	const backdrop = useBackdropDismiss(onDismiss);
	return { surface, backdrop };
}
