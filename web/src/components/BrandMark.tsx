/**
 * A beacon, which is what a notice to airmen is: something switched on so that
 * everyone flying through reads it before they go. Three arcs and a core,
 * drawn on a 16-unit grid so the strokes land on whole pixels at the size the
 * header uses it.
 *
 * `currentColor` throughout, so the one lockup serves the header band, a
 * favicon-sized mark, and anything later that needs it, without a second copy
 * carrying a hard-coded hue.
 */
export function BrandMark({ className }: { className?: string }) {
	return (
		<svg
			className={className}
			viewBox="0 0 16 16"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.6"
			strokeLinecap="round"
			aria-hidden="true"
		>
			<circle cx="8" cy="8" r="2.1" fill="currentColor" stroke="none" />
			{/*
				Opposed arcs rather than full rings: a ring reads as a target, and
				the gap on each side is what makes this read as a signal leaving.
			*/}
			<path d="M4.4 4.4a5 5 0 0 0 0 7.2" opacity="0.75" />
			<path d="M11.6 4.4a5 5 0 0 1 0 7.2" opacity="0.75" />
			<path d="M1.9 1.9a8.6 8.6 0 0 0 0 12.2" opacity="0.4" />
			<path d="M14.1 1.9a8.6 8.6 0 0 1 0 12.2" opacity="0.4" />
		</svg>
	);
}
