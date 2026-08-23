export type Chip = { value: string; label: string; count: number };

export function FilterChips({
	chips,
	active,
	onChange,
}: {
	chips: Chip[];
	active: string;
	onChange: (value: string) => void;
}) {
	return (
		// biome-ignore lint/a11y/useSemanticElements: a fieldset's default browser chrome doesn't fit a row of filter chips; role="group" + aria-label is the documented equivalent.
		<div className="chips" role="group" aria-label="Filters">
			{chips.map((chip) => (
				<button
					key={chip.value}
					type="button"
					aria-pressed={chip.value === active}
					// Clicking the active chip clears it, so a filter is never a trap.
					onClick={() => onChange(chip.value === active ? "" : chip.value)}
				>
					{/* The literal space is load-bearing: it keeps the accessible
					    name "Unanalysed 12" rather than "Unanalysed12". */}
					{chip.label} <span className="chip-count">{chip.count}</span>
				</button>
			))}
		</div>
	);
}
