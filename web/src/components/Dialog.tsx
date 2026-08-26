import type { ReactNode } from "react";
import { useModalSurface } from "../lib/modal.ts";

/**
 * A decision to take: the same window `Panel` renders, with a foot carrying
 * the two answers.
 */
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
	// Cancel, not confirm: a click that lands outside a window can only ever
	// mean "not this", and a pre-flight that committed files to someone else's
	// repository on a stray click would be indefensible.
	const { surface, backdrop } = useModalSurface(onCancel);
	return (
		<div className="overlay" {...backdrop}>
			<div
				className="window"
				role="dialog"
				aria-modal="true"
				aria-label={title}
				ref={surface}
				tabIndex={-1}
			>
				<div className="window-head">
					<h2>{title}</h2>
				</div>
				<div className="window-body">{children}</div>
				{/*
					The foot is pinned rather than trailing the content: a promotion
					plan can run to several screens of file previews, and a confirm
					button you have to scroll to find is a confirm button people miss.
				*/}
				<div className="window-foot">
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
