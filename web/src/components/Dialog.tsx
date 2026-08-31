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
	confirmDanger = false,
	children,
}: {
	title: string;
	confirmLabel: string;
	onConfirm: () => void;
	onCancel: () => void;
	confirmDisabled?: boolean;
	confirmDanger?: boolean;
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
						className={confirmDanger ? "btn-danger" : "btn-primary"}
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

/**
 * The commonest decision in the app: a yes/no question whose consequence fits
 * on a single line. It is the same window every other overlay renders in,
 * because the browser's own confirm box takes no styling, holds no focus trap,
 * and stops the whole page while it waits for an answer.
 */
export function ConfirmDialog({
	title,
	message,
	confirmLabel,
	confirmDanger,
	onConfirm,
	onCancel,
}: {
	title: string;
	message: string;
	confirmLabel: string;
	confirmDanger?: boolean;
	onConfirm: () => void;
	onCancel: () => void;
}) {
	return (
		<Dialog
			title={title}
			confirmLabel={confirmLabel}
			confirmDanger={confirmDanger}
			onConfirm={onConfirm}
			onCancel={onCancel}
		>
			<p>{message}</p>
		</Dialog>
	);
}
