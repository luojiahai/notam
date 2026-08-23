/**
 * The three things a table can be other than a list of rows. They live together
 * because they have to agree: the skeleton has to occupy the same rhythm the
 * real rows will, or the screen jumps when data lands.
 */

/** Column widths chosen to echo a real row: checkbox, id, long title, then metadata. */
const SKELETON_COLUMNS = ["0.875rem", "2.5rem", "40%", "3rem", "3rem", "5rem"];

export function TableSkeleton({ rows = 6 }: { rows?: number }) {
	// Keys are derived rather than positional. The grid is fixed and never
	// reorders, but a bare index key still reads as an oversight.
	const cells = Array.from({ length: rows }, (_, row) =>
		SKELETON_COLUMNS.map((width, column) => ({
			key: `r${row}c${column}`,
			width,
			// Staggered so a row reads as one object arriving, not six bars
			// blinking in lockstep.
			delay: (row * SKELETON_COLUMNS.length + column) * 40,
		})),
	);
	return (
		<div aria-hidden="true">
			{cells.map((row) => (
				<div className="skeleton-row" key={row[0]?.key}>
					{row.map((cell) => (
						<span
							className="skeleton-bar"
							key={cell.key}
							style={{ width: cell.width, animationDelay: `${cell.delay}ms` }}
						/>
					))}
				</div>
			))}
		</div>
	);
}

export function TableEmpty({ title, hint }: { title: string; hint?: string }) {
	return (
		<div className="state">
			<p className="state-title">{title}</p>
			{hint && <p className="state-hint">{hint}</p>}
		</div>
	);
}

/** Server text, verbatim: the message is the whole value of this state. */
export function TableError({ message }: { message: string }) {
	return (
		<div className="state state-error" role="alert">
			<p className="state-title">Could not load this list</p>
			<p className="state-hint">{message}</p>
		</div>
	);
}
