/**
 * Theme selection: `"system"` follows the OS, `"light"` and `"dark"` override
 * it. The choice is written to `<html data-theme>`, which is what styles.css
 * keys on, and remembered in localStorage so it survives a reload.
 *
 * `"system"` deliberately *removes* the attribute rather than resolving the
 * preference to a fixed value: with no attribute the stylesheet's
 * `prefers-color-scheme` block applies, so a machine that flips to dark at
 * sunset flips this tab with it, with no listener to register or leak.
 */
export type Theme = "system" | "light" | "dark";

export const THEME_STORAGE_KEY = "notam.theme";

export function isTheme(value: unknown): value is Theme {
	return value === "system" || value === "light" || value === "dark";
}

/**
 * Storage access is guarded: Safari throws on `localStorage` in some privacy
 * modes, and a theme preference is never worth taking the app down for.
 */
export function readTheme(storage: Storage | undefined = safeStorage()): Theme {
	try {
		const stored = storage?.getItem(THEME_STORAGE_KEY);
		return isTheme(stored) ? stored : "system";
	} catch {
		return "system";
	}
}

export function storeTheme(
	theme: Theme,
	storage: Storage | undefined = safeStorage(),
): void {
	try {
		if (theme === "system") storage?.removeItem(THEME_STORAGE_KEY);
		else storage?.setItem(THEME_STORAGE_KEY, theme);
	} catch {
		// A browser that refuses to persist still gets the theme for this tab.
	}
}

export function applyTheme(theme: Theme, root: HTMLElement): void {
	if (theme === "system") root.removeAttribute("data-theme");
	else root.setAttribute("data-theme", theme);
}

function safeStorage(): Storage | undefined {
	try {
		return globalThis.localStorage;
	} catch {
		return undefined;
	}
}
