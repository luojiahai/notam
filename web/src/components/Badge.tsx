import type { ReactNode } from "react";

export type BadgeKind = "do" | "dont" | "neutral";

/**
 * A rule's kind. Filled and monospace, because in a table of a hundred rules
 * the DO/DON'T column is the one you scan down rather than read.
 */
export function Badge({
	kind = "neutral",
	children,
}: {
	kind?: BadgeKind;
	children: ReactNode;
}) {
	const className =
		kind === "do"
			? "badge badge-do"
			: kind === "dont"
				? "badge badge-dont"
				: "badge";
	return <span className={className}>{children}</span>;
}

/**
 * Lifecycle state — a rule's draft/proposed/verified/abandoned, a promotion's
 * open/merged/closed. Deliberately a different shape from `Badge`: an outlined
 * pill, so kind and status never read as the same kind of thing when they sit
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
