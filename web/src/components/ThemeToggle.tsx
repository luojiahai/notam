import { useCallback, useEffect, useState } from "react";
import { applyTheme, readTheme, storeTheme, type Theme } from "../lib/theme.ts";

const OPTIONS: { value: Theme; label: string }[] = [
	{ value: "light", label: "Light" },
	{ value: "dark", label: "Dark" },
	{ value: "system", label: "Auto" },
];

/**
 * Text labels rather than a sun/moon glyph, and the one control in the header
 * that keeps them. The icons beside it are actions and destinations, which a
 * glyph names as well as a word does; this displays which of three modes is
 * live, and a single cycling glyph could not.
 *
 * Three explicit states also beat a two-way switch, which cannot express "let
 * the machine decide" — the state most people actually want.
 */
export function ThemeToggle() {
	const [theme, setTheme] = useState<Theme>(() => readTheme());

	// index.html applies the stored theme before first paint; this keeps the
	// attribute in step with the control for the rest of the session.
	useEffect(() => {
		applyTheme(theme, document.documentElement);
	}, [theme]);

	const choose = useCallback((next: Theme) => {
		storeTheme(next);
		setTheme(next);
	}, []);

	return (
		// biome-ignore lint/a11y/useSemanticElements: a radiogroup would need arrow-key roving focus for three adjacent one-word buttons; aria-pressed on plain buttons is the simpler equivalent and tabs through naturally.
		<div className="segmented" role="group" aria-label="Colour theme">
			{OPTIONS.map((option) => (
				<button
					key={option.value}
					type="button"
					aria-pressed={theme === option.value}
					onClick={() => choose(option.value)}
				>
					{option.label}
				</button>
			))}
		</div>
	);
}
