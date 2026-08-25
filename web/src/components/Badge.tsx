import type { ReactNode } from "react";

/**
 * A rule's type. Filled and monospace, because in a table of a hundred rules
 * the type column is the one you scan down rather than read. One treatment for
 * every value on purpose: a tint per type would turn that column into confetti
 * and would eat the hue separation the accent depends on.
 */
export function Badge({ children }: { children: ReactNode }) {
	return <span className="badge">{children}</span>;
}

/**
 * Lifecycle state — a rule's draft/proposed/verified/abandoned, a promotion's
 * open/merged/closed. Deliberately a different shape from `Badge`: an outlined
 * pill, so type and status never read as the same kind of thing when they sit
 * in adjacent columns.
 *
 * `draft` and `open` take the neutral treatment on purpose. They are the
 * common case, and colouring the common case colours the whole screen.
 *
 * With `onClick` the pill *is* the button rather than sitting inside one: a
 * wrapper would put a second focus ring around the outline the pill already
 * has. `label` is then required, because a column of pills whose accessible
 * name is the word they display reads as a column of identical buttons.
 */
export function StatusPill({
	status,
	onClick,
	label,
}:
	| { status: string; onClick?: undefined; label?: undefined }
	| { status: string; onClick: () => void; label: string }) {
	const className = `status status-${status}`;
	if (onClick === undefined) {
		return <span className={className}>{status}</span>;
	}
	return (
		<button
			type="button"
			className={`${className} status-button`}
			aria-label={label}
			onClick={onClick}
		>
			{status}
		</button>
	);
}
