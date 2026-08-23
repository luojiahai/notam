import type { ReactNode } from "react";

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
	return (
		<div className="dialog-backdrop">
			<div
				className="dialog"
				role="dialog"
				aria-modal="true"
				aria-label={title}
			>
				<h2 style={{ marginTop: 0 }}>{title}</h2>
				{children}
				<div
					style={{
						display: "flex",
						gap: "0.5rem",
						justifyContent: "flex-end",
						marginTop: "1rem",
					}}
				>
					<button type="button" onClick={onCancel}>
						Cancel
					</button>
					<button type="button" onClick={onConfirm} disabled={confirmDisabled}>
						{confirmLabel}
					</button>
				</div>
			</div>
		</div>
	);
}
