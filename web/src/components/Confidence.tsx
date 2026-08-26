/** Below this a rule is worth reading before promoting rather than scanning past. */
const SURE_ENOUGH = 0.75;

/**
 * A rule's confidence as a bar beside the number, never instead of it.
 *
 * The digits are the value and the bar is a second reading of the same value,
 * so a reader who sees no colour at all loses nothing. Weak confidence dims the
 * bar rather than recolouring it: `--warn` is the accent's own hue here, so a
 * hue change would say nothing, and a bar with less ink in it is what "less
 * agreement" looks like anyway.
 */
export function Confidence({ value }: { value: number }) {
	const bounded = Math.min(1, Math.max(0, value));
	return (
		<span className="confidence">
			{/*
				Hidden: the number beside it is the accessible value, and a screen
				reader announcing a percentage and then a decimal of the same thing
				reads as two figures that disagree.
			*/}
			<span
				className="confidence-meter"
				data-weak={bounded < SURE_ENOUGH}
				aria-hidden="true"
			>
				<span style={{ width: `${Math.round(bounded * 100)}%` }} />
			</span>
			{value.toFixed(2)}
		</span>
	);
}
