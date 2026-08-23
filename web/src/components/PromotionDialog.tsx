import type { PromotionPlanView } from "../../../src/shared/api.ts";
import { basename } from "../lib/path.ts";
import { Dialog } from "./Dialog.tsx";

export type PromotionDialogProps = {
	plan: PromotionPlanView;
	included: string[];
	onToggle: (ruleId: string) => void;
	onCancel: () => void;
	onConfirm: () => void;
	submitting: boolean;
	planning: boolean;
	error: string | null;
};

/**
 * Spec section 7's pre-flight. The collision sentence is quoted from the spec
 * on purpose: committing `…-2.md` without saying so is the silent footgun this
 * dialog exists to prevent.
 *
 * Each file is a bordered block rather than a run of list items, because this
 * is the last screen before something is written to someone else's repository:
 * the boundary between one committed file and the next has to be unmistakable.
 */
export function PromotionDialog(props: PromotionDialogProps) {
	const collisionFor = new Map(
		props.plan.collisions.map((collision) => [collision.rule_id, collision]),
	);

	return (
		<Dialog
			title="Create rules pull request"
			confirmLabel={props.submitting ? "Creating…" : "Create pull request"}
			confirmDisabled={
				props.submitting || props.planning || props.included.length === 0
			}
			onCancel={props.onCancel}
			onConfirm={props.onConfirm}
		>
			<p className="secondary">
				{props.included.length} file
				{props.included.length === 1 ? "" : "s"} onto{" "}
				<code>{props.plan.base_branch}</code> in{" "}
				<code>{props.plan.repo_name}</code>.
			</p>

			{props.error && (
				<p className="notice notice-error" role="alert">
					{props.error}
				</p>
			)}

			<ul className="plan-list">
				{props.plan.files.map((file) => {
					const collision = collisionFor.get(file.rule_id);
					const included = props.included.includes(file.rule_id);
					return (
						<li
							className="plan-file"
							data-excluded={!included}
							key={file.rule_id}
						>
							<div className="plan-file-head">
								<label className="plan-file-label">
									<input
										type="checkbox"
										checked={included}
										onChange={() => props.onToggle(file.rule_id)}
									/>
									<span>{file.directive}</span>
								</label>
								<div className="plan-file-path">{file.path}</div>
								{collision && (
									<p className="notice notice-warn">
										{basename(collision.existing)} already exists in{" "}
										{props.plan.repo_name}; promoting adds a second file.
									</p>
								)}
							</div>
							<div className="plan-file-body">
								<pre>{file.content}</pre>
							</div>
						</li>
					);
				})}
			</ul>
		</Dialog>
	);
}
