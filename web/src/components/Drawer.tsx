import type { ReactNode } from "react";
import { useDismissOnEscape } from "../lib/dismiss.ts";

export function Drawer({
	title,
	onClose,
	children,
}: {
	title: string;
	onClose: () => void;
	children: ReactNode;
}) {
	useDismissOnEscape(onClose);
	return (
		<>
			{/*
				Presentational: it dims the table so the drawer reads as the
				foreground, and clicking it closes, which is what everyone tries
				first. It is hidden from the accessibility tree because it
				duplicates affordances that already exist — the Close button for
				pointer and screen-reader users, Escape for the keyboard.
			*/}
			<div className="scrim" aria-hidden="true" onClick={onClose} />
			<aside className="drawer" aria-label={title}>
				<div className="drawer-head">
					<h2>{title}</h2>
					<button
						type="button"
						className="btn-close"
						onClick={onClose}
						aria-label="Close"
					>
						×
					</button>
				</div>
				<div className="drawer-body">{children}</div>
			</aside>
		</>
	);
}
