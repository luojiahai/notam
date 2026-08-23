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

			{props.error && <p className="error">{props.error}</p>}

			<ul style={{ listStyle: "none", padding: 0 }}>
				{props.plan.files.map((file) => {
					const collision = collisionFor.get(file.rule_id);
					return (
						<li key={file.rule_id} style={{ marginBottom: "0.75rem" }}>
							<label>
								<input
									type="checkbox"
									checked={props.included.includes(file.rule_id)}
									onChange={() => props.onToggle(file.rule_id)}
								/>{" "}
								{file.directive}
							</label>
							<div className="secondary">
								<code>{file.path}</code>
							</div>
							{collision && (
								<div className="warning">
									{basename(collision.existing)} already exists in{" "}
									{props.plan.repo_name}; promoting adds a second file.
								</div>
							)}
							<pre>{file.content}</pre>
						</li>
					);
				})}
			</ul>
		</Dialog>
	);
}
