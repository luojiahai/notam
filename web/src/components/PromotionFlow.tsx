import { useEffect, useState } from "react";
import type { PromotionPlanView } from "../../../src/shared/api.ts";
import { useCreatePromotion, usePlanPromotion } from "../api/hooks.ts";
import { Dialog } from "./Dialog.tsx";
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
	const [shown, setShown] = useState<PromotionPlanView | null>(null);
	const plan = usePlanPromotion();
	const create = useCreatePromotion();

	// biome-ignore lint/correctness/useExhaustiveDependencies: `plan` is a stable mutation object; re-planning is driven by `included` alone.
	useEffect(() => {
		if (included.length > 0) plan.mutate(included);
	}, [included]);

	// React Query's `pending` reducer clears `data`, so without this the whole
	// list would unmount and flash "Checking the base branch…" on every
	// checkbox toggle. Holding the previous plan is also what makes the
	// dialog's `planning` flag meaningful rather than unreachable.
	useEffect(() => {
		if (plan.data) setShown(plan.data);
	}, [plan.data]);

	if (!shown) {
		return (
			<Dialog
				title="Create rules pull request"
				confirmLabel="Close"
				onCancel={onClose}
				onConfirm={onClose}
			>
				{plan.error ? (
					<p className="error">{plan.error.message}</p>
				) : (
					<p className="secondary">Checking the base branch…</p>
				)}
			</Dialog>
		);
	}

	return (
		<PromotionDialog
			plan={shown}
			included={included}
			planning={plan.isPending}
			submitting={create.isPending}
			// A re-plan that fails leaves the previous plan on screen, so its
			// error has to surface here rather than only in the branch above.
			error={create.error?.message ?? plan.error?.message ?? null}
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
