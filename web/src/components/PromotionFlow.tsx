import { useEffect, useState } from "react";
import { useCreatePromotion, usePlanPromotion } from "../api/hooks.ts";
import { PromotionDialog } from "./PromotionDialog.tsx";

/**
 * Plans, re-plans, then creates.
 *
 * Deselecting inside the dialog re-plans rather than just dropping a row,
 * because collision suffixes are assigned across the whole batch: removing the
 * first rule can free the unsuffixed name for the second, and showing a stale
 * `-2` would be a lie about what is going to be committed.
 */
export function PromotionFlow({
	ruleIds,
	onClose,
}: {
	ruleIds: string[];
	onClose: () => void;
}) {
	const [included, setIncluded] = useState<string[]>(ruleIds);
	const plan = usePlanPromotion();
	const create = useCreatePromotion();

	// biome-ignore lint/correctness/useExhaustiveDependencies: `plan` is a stable mutation object; re-planning is driven by `included` alone.
	useEffect(() => {
		if (included.length > 0) plan.mutate(included);
	}, [included]);

	if (!plan.data) {
		return (
			<div className="dialog-backdrop">
				<div
					className="dialog"
					role="dialog"
					aria-modal="true"
					aria-label="Create rules pull request"
				>
					{plan.error ? (
						<p className="error">{plan.error.message}</p>
					) : (
						<p className="secondary">Checking the base branch…</p>
					)}
					<button type="button" onClick={onClose}>
						Close
					</button>
				</div>
			</div>
		);
	}

	return (
		<PromotionDialog
			plan={plan.data}
			included={included}
			planning={plan.isPending}
			submitting={create.isPending}
			error={create.error?.message ?? null}
			onToggle={(ruleId) =>
				setIncluded((current) =>
					current.includes(ruleId)
						? current.filter((id) => id !== ruleId)
						: [...current, ruleId],
				)
			}
			onCancel={onClose}
			onConfirm={() =>
				create.mutate(included, {
					onSuccess: () => onClose(),
				})
			}
		/>
	);
}
