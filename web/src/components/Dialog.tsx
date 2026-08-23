import type { ReactNode } from "react";
import { useDismissOnEscape } from "../lib/dismiss.ts";

export function Dialog({
	title,
	confirmLabel,
	onConfirm,
	onCancel,
	confirmDisabled = false,
	children,
}: {
	title: string;
	confirmLabel: string;
	onConfirm: () => void;
	onCancel: () => void;
	confirmDisabled?: boolean;
	children: ReactNode;
}) {
	useDismissOnEscape(onCancel);
	return (
		<div className="dialog-backdrop">
			<div
				className="dialog"
				role="dialog"
				aria-modal="true"
				aria-label={title}
			>
				<div className="dialog-head">
					<h2>{title}</h2>
				</div>
				<div className="dialog-body">{children}</div>
				{/*
					The footer is pinned rather than trailing the content: a promotion
					plan can run to several screens of file previews, and a confirm
					button you have to scroll to find is a confirm button people miss.
				*/}
				<div className="dialog-foot">
					<button type="button" onClick={onCancel}>
						Cancel
					</button>
					<button
						type="button"
						className="btn-primary"
						onClick={onConfirm}
						disabled={confirmDisabled}
					>
						{confirmLabel}
					</button>
				</div>
			</div>
		</div>
	);
}
