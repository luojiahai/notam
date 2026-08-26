import type {
	KeyboardEvent as ReactKeyboardEvent,
	PointerEvent as ReactPointerEvent,
} from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { SidebarBounds } from "../lib/sidebar-width.ts";
import {
	applySidebarWidth,
	clampSidebarWidth,
	peekSidebarWidth,
	readSidebarBounds,
	readSidebarWidth,
	restoreSidebarWidth,
	SIDEBAR_WIDTH_FALLBACK_MAX,
	SIDEBAR_WIDTH_FALLBACK_MIN,
	storeSidebarWidth,
} from "../lib/sidebar-width.ts";

/** Arrow keys nudge; Shift jumps. Home and End go to the bounds themselves. */
const STEP = 16;
const SHIFT_STEP = 64;

type Drag = {
	pointerId: number;
	startX: number;
	/** The sidebar's real width when the drag began; the delta is added to it. */
	startWidth: number;
	/** The override as it stood before the drag, which Escape puts back. */
	startInline: string;
	bounds: SidebarBounds;
};

/**
 * The drag handle on the sidebar's right edge.
 *
 * Self-contained on purpose: nothing outside it ever reads the width, because
 * the stylesheet does the laying out from `--sidebar-w`. Lifting the value to
 * `App` would thread a number through `Shell` that neither `Shell` nor any of
 * its children consume.
 *
 * A drag writes the custom property straight to `<html>` on every pointer
 * move and leaves React alone until release, so the tables underneath do not
 * re-render per frame. React state exists only to keep the announced value
 * honest for a screen reader.
 */
export function SidebarResizer() {
	const ref = useRef<HTMLDivElement>(null);
	const dragRef = useRef<Drag | null>(null);
	/** Applied to the layout but not yet committed to state or storage. */
	const pendingRef = useRef<number | null>(null);
	const [width, setWidth] = useState<number | null>(null);
	const [bounds, setBounds] = useState<SidebarBounds>({
		min: SIDEBAR_WIDTH_FALLBACK_MIN,
		max: SIDEBAR_WIDTH_FALLBACK_MAX,
	});

	/*
	 * The sidebar is the handle's previous sibling. Shell renders the two
	 * together for exactly this reason: `sidebar` reaches Shell as an opaque
	 * ReactNode, so there is no ref to thread, and querying the document for a
	 * class name would reach past this subtree.
	 */
	const sidebarEl = useCallback(
		() => ref.current?.previousElementSibling ?? null,
		[],
	);

	const commit = useCallback(() => {
		const pending = pendingRef.current;
		pendingRef.current = null;
		if (pending === null) return;
		setWidth(pending);
		storeSidebarWidth(pending);
	}, []);

	useEffect(() => {
		const root = document.documentElement;
		const sidebar = sidebarEl();
		const stored = readSidebarWidth();
		// The pre-paint script in index.html normally did this already; repeating
		// it costs nothing and covers a page that never ran it.
		if (stored !== null) applySidebarWidth(stored, root);

		const sync = () => {
			const next = readSidebarBounds(root);
			setBounds(next);
			// Mid-drag the live width goes straight to CSS and React is deliberately
			// left out of the loop; the committed value lands on release.
			if (dragRef.current) return;
			const box = sidebar?.getBoundingClientRect().width ?? 0;
			// The stored width stands in only where there is no layout to measure.
			const measured = box > 0 ? box : stored;
			setWidth(measured === null ? null : clampSidebarWidth(measured, next));
		};
		sync();

		/*
		 * Narrowing the window re-clamps the track through CSS alone, but the
		 * announced value would then describe a width the sidebar no longer has.
		 * Observing the element reports what actually happened rather than
		 * recomputing what CSS already decided, and stays quiet through a resize
		 * that only changes the height.
		 */
		if (!sidebar || typeof ResizeObserver === "undefined") return;
		const observer = new ResizeObserver(sync);
		observer.observe(sidebar);
		return () => observer.disconnect();
	}, [sidebarEl]);

	/*
	 * Clears the drag before releasing capture: the release fires
	 * `lostpointercapture`, which re-enters the same path, and a null ref is
	 * what makes that second pass a no-op instead of a double commit.
	 */
	const endDrag = useCallback((el: HTMLElement, drag: Drag) => {
		dragRef.current = null;
		if (el.hasPointerCapture?.(drag.pointerId)) {
			el.releasePointerCapture(drag.pointerId);
		}
		document.documentElement.removeAttribute("data-resizing");
	}, []);

	const cancelDrag = useCallback(() => {
		const drag = dragRef.current;
		const el = ref.current;
		if (!drag || !el) return;
		restoreSidebarWidth(drag.startInline, document.documentElement);
		pendingRef.current = null;
		endDrag(el, drag);
	}, [endDrag]);

	/*
	 * Mounted for the component's life rather than added per drag: the guard is
	 * a null check either way, and a listener that is never added and removed
	 * cannot be left behind by a drag that ended down an unusual path.
	 */
	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape" && dragRef.current) cancelDrag();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [cancelDrag]);

	function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
		const el = ref.current;
		const sidebar = sidebarEl();
		if (event.button !== 0 || !el || !sidebar) return;
		const next = readSidebarBounds(document.documentElement);
		setBounds(next);
		dragRef.current = {
			pointerId: event.pointerId,
			startX: event.clientX,
			startWidth: sidebar.getBoundingClientRect().width,
			startInline: peekSidebarWidth(document.documentElement),
			bounds: next,
		};
		// Capture means the pointer leaving the handle, the sidebar, or the window
		// is not a case to handle: the events keep arriving here until release.
		el.setPointerCapture(event.pointerId);
		document.documentElement.setAttribute("data-resizing", "");
		event.preventDefault();
	}

	function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
		const drag = dragRef.current;
		if (!drag || event.pointerId !== drag.pointerId) return;
		/*
		 * Delta from where the drag started, not the raw pointer x. The two agree
		 * only because the sidebar happens to begin at the viewport's left edge,
		 * and the day anything is placed left of it the absolute form is silently
		 * wrong. It also gives Escape the width to restore, for free.
		 */
		const next = clampSidebarWidth(
			drag.startWidth + (event.clientX - drag.startX),
			drag.bounds,
		);
		applySidebarWidth(next, document.documentElement);
		pendingRef.current = next;
	}

	function onPointerRelease() {
		const drag = dragRef.current;
		const el = ref.current;
		if (!drag || !el) return;
		endDrag(el, drag);
		commit();
	}

	function onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
		const next = readSidebarBounds(document.documentElement);
		// Without a resolvable width the floor is the honest place to start.
		const base = pendingRef.current ?? width ?? next.min;
		const step = event.shiftKey ? SHIFT_STEP : STEP;
		const target =
			event.key === "ArrowLeft"
				? base - step
				: event.key === "ArrowRight"
					? base + step
					: event.key === "Home"
						? next.min
						: event.key === "End"
							? next.max
							: null;
		if (target === null) return;
		event.preventDefault();
		const clamped = clampSidebarWidth(target, next);
		applySidebarWidth(clamped, document.documentElement);
		setBounds(next);
		setWidth(clamped);
		pendingRef.current = clamped;
	}

	/*
	 * Held down, an arrow key repeats; persisting each repeat would write
	 * storage dozens of times for one gesture. Committing on release matches
	 * what a drag does, so both gestures cost exactly one write.
	 */
	function onKeyUp() {
		commit();
	}

	/*
	 * Reset clears the preference rather than storing the default, so the
	 * default keeps living in the stylesheet alone. Anyone who resets tracks it
	 * if it ever changes, instead of being pinned to today's value.
	 */
	function onDoubleClick() {
		applySidebarWidth(null, document.documentElement);
		storeSidebarWidth(null);
		pendingRef.current = null;
		const box = sidebarEl()?.getBoundingClientRect().width ?? 0;
		setWidth(box > 0 ? box : null);
	}

	const announced = Math.round(width ?? bounds.min);
	return (
		// An <hr> cannot hold focus, and this separator is operated, not merely drawn.
		// biome-ignore lint/a11y/useSemanticElements: a focusable separator needs a div
		<div
			ref={ref}
			className="sidebar-resizer"
			role="separator"
			aria-orientation="vertical"
			aria-label="Resize sidebar"
			aria-valuenow={announced}
			aria-valuemin={Math.round(bounds.min)}
			aria-valuemax={Math.round(bounds.max)}
			// `aria-valuenow` alone is announced as a bare number with no unit.
			aria-valuetext={`${announced} pixels`}
			tabIndex={0}
			onPointerDown={onPointerDown}
			onPointerMove={onPointerMove}
			onPointerUp={onPointerRelease}
			onLostPointerCapture={onPointerRelease}
			onKeyDown={onKeyDown}
			onKeyUp={onKeyUp}
			onDoubleClick={onDoubleClick}
		/>
	);
}
