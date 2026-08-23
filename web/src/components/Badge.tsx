import type { ReactNode } from "react";

export type BadgeKind = "do" | "dont" | "neutral";

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
