import type { ReactNode } from "react";

export function Drawer({
	title,
	onClose,
	children,
}: {
	title: string;
	onClose: () => void;
	children: ReactNode;
}) {
	return (
		<aside className="drawer" aria-label={title}>
			<div style={{ display: "flex", alignItems: "start", gap: "1rem" }}>
				<h2 style={{ margin: 0, flex: 1, fontSize: "1rem" }}>{title}</h2>
				<button type="button" onClick={onClose} aria-label="Close">
					×
				</button>
			</div>
			{children}
		</aside>
	);
}
