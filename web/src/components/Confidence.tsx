/**
 * Below this, the analyser was guessing enough that a human should read the
 * source thread before promoting the rule. The meter changes hue there rather
 * than shading continuously: a gradient would ask the eye to judge a value it
 * is already being told in digits, whereas one threshold answers the only
 * question the column exists for.
 */
const SHAKY = 0.75;

/**
 * How sure the analyser was, as a ratio against a limit — a meter, which is
 * the form for exactly that, rather than a bare number the eye has to rank
 * against its neighbours.
 *
 * The track is a light step of the fill's own hue, so the unfilled part reads
 * as the same measurement rather than as empty chrome, and the digits sit
 * beside it in text ink. Colour is never the only channel: the number is
 * always there, which is what keeps the low-confidence hue from being the sole
 * carrier of the warning.
 */
export function Confidence({ value }: { value: number }) {
	// Clamped because the column is a fixed-width track: a value outside the
	// range would silently draw a full or empty bar and misstate itself.
	const ratio = Math.min(1, Math.max(0, value));
	return (
		<span className="confidence" data-shaky={ratio < SHAKY}>
			<span className="confidence-track">
				<span
					className="confidence-fill"
					style={{ inlineSize: `${ratio * 100}%` }}
				/>
			</span>
			<span className="confidence-value">{value.toFixed(2)}</span>
		</span>
	);
}
