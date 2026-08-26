import { X } from "lucide-react";
import type { ReactNode } from "react";
import { useModalSurface } from "../lib/modal.ts";

/**
 * A record opened for reading: an entry, a rule.
 *
 * One overlay shape serves the whole app. A panel and a dialog are the same
 * window in the same place, differing only in what fills the foot — this one
 * has no decision to take, so it has no foot at all. Two overlay geometries in
 * one app read as one of them having missed, and the reader has no way to know
 * which is deliberate.
 */
export function Panel({
	title,
	onClose,
	children,
}: {
	title: string;
	onClose: () => void;
	children: ReactNode;
}) {
	const { surface, backdrop } = useModalSurface(onClose);
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
					<button
						type="button"
						className="btn-close"
						onClick={onClose}
						aria-label="Close"
					>
						<X className="icon" aria-hidden="true" />
					</button>
				</div>
				<div className="window-body">{children}</div>
			</div>
		</div>
	);
}
