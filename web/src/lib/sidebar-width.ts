/**
 * The sidebar's width: a pixel preference remembered per browser, applied by
 * writing `--sidebar-w` to `<html>`, which is what the `.body` grid track and
 * the drag handle's position both key on.
 *
 * The bounds are not written here. `styles.css` owns them as `--sidebar-w-min`
 * and `--sidebar-w-max` and clamps the track itself, so a stored width outside
 * them is already displayed correctly with no JavaScript involved. This module
 * only reads them back, because `aria-valuemin`/`aria-valuemax` and the
 * Home/End targets need numbers and CSS cannot hand those to a screen reader.
 *
 * No preference is stored as the *absence* of the key rather than as the
 * default width, matching `theme.ts`: with the key gone the stylesheet's own
 * `--sidebar-w` applies, so the default lives in exactly one place and a reset
 * keeps tracking it if it ever changes.
 */

export const SIDEBAR_WIDTH_STORAGE_KEY = "notam.sidebar-width";

/**
 * Used only when the tokens cannot be resolved — before the stylesheet has
 * arrived, or in a DOM that never loads one. They mirror the `11rem`/`30rem`
 * in styles.css at the browser's default root size; a page that has its real
 * stylesheet never reaches them.
 */
export const SIDEBAR_WIDTH_FALLBACK_MIN = 176;
export const SIDEBAR_WIDTH_FALLBACK_MAX = 480;

export type SidebarBounds = { min: number; max: number };

/**
 * Storage access is guarded: Safari throws on `localStorage` in some privacy
 * modes, and a pane width is never worth taking the app down for.
 */
export function readSidebarWidth(
	storage: Storage | undefined = safeStorage(),
): number | null {
	try {
		return toWidth(storage?.getItem(SIDEBAR_WIDTH_STORAGE_KEY));
	} catch {
		return null;
	}
}

/** `null` clears the preference; any width is rounded to whole pixels. */
export function storeSidebarWidth(
	px: number | null,
	storage: Storage | undefined = safeStorage(),
): void {
	try {
		if (px === null) storage?.removeItem(SIDEBAR_WIDTH_STORAGE_KEY);
		else storage?.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(Math.round(px)));
	} catch {
		// A browser that refuses to persist still gets the width for this tab.
	}
}

/** `null` removes the override, letting the stylesheet's default apply. */
export function applySidebarWidth(px: number | null, root: HTMLElement): void {
	if (px === null) root.style.removeProperty("--sidebar-w");
	else root.style.setProperty("--sidebar-w", `${Math.round(px)}px`);
}

/**
 * The override exactly as it stands, for putting back later. An abandoned drag
 * has to restore what was there rather than re-derive it: the width on screen
 * may be a clamped one the window imposed, and re-applying that would turn a
 * temporarily narrow window into the reader's standing preference.
 */
export function peekSidebarWidth(root: HTMLElement): string {
	return root.style.getPropertyValue("--sidebar-w");
}

export function restoreSidebarWidth(value: string, root: HTMLElement): void {
	if (value === "") root.style.removeProperty("--sidebar-w");
	else root.style.setProperty("--sidebar-w", value);
}

/**
 * The tokens are registered with `@property … syntax: "<length>"`, so unlike an
 * ordinary custom property they compute to a resolved pixel length here rather
 * than to the `11rem` / `min(30rem, 40vw)` written in the stylesheet. That is
 * what keeps the bounds correct for a reader who has raised their default font
 * size, instead of assuming a 16px root.
 */
export function readSidebarBounds(root: HTMLElement): SidebarBounds {
	const styles = getComputedStyle(root);
	return {
		min: toLength(
			styles.getPropertyValue("--sidebar-w-min"),
			SIDEBAR_WIDTH_FALLBACK_MIN,
		),
		max: toLength(
			styles.getPropertyValue("--sidebar-w-max"),
			SIDEBAR_WIDTH_FALLBACK_MAX,
		),
	};
}

/**
 * The floor wins a contradiction. A viewport narrow enough to put the ceiling
 * below the floor is one where the sidebar's own contents have already stopped
 * fitting, and squeezing further helps nothing.
 */
export function clampSidebarWidth(px: number, bounds: SidebarBounds): number {
	return Math.max(bounds.min, Math.min(px, bounds.max));
}

function toWidth(value: string | null | undefined): number | null {
	const px = Number.parseFloat(value ?? "");
	return Number.isFinite(px) && px > 0 ? px : null;
}

function toLength(value: string, fallback: number): number {
	return toWidth(value) ?? fallback;
}

function safeStorage(): Storage | undefined {
	try {
		return globalThis.localStorage;
	} catch {
		return undefined;
	}
}
