import type { RuleDetail } from "../../../src/shared/api.ts";
import { useRule } from "../api/hooks.ts";
import { Badge, StatusPill } from "./Badge.tsx";
import { Drawer } from "./Drawer.tsx";

/**
 * The fragment of a comment URL worth showing — `#discussion_r123` — falling
 * back to the whole URL. These come from the model and are unconstrained, so a
 * URL with no `#` must not be sliced to its last character.
 */
function commentLabel(url: string): string {
	const hash = url.indexOf("#");
	return hash === -1 ? url : url.slice(hash);
}

/** Read-only. Editing a rule's text is out of scope for v1; re-analysis is the recovery path. */
export function RuleDrawerView({ rule }: { rule: RuleDetail }) {
	return (
		<>
			<p className="meta-line">
				<Badge kind={rule.kind}>{rule.kind === "do" ? "DO" : "DON'T"}</Badge>
				<StatusPill status={rule.status} />
				<span>confidence {rule.confidence.toFixed(2)}</span>
			</p>

			<h3>Rationale</h3>
			<p className="prose">{rule.rationale}</p>

			<h3>Scope</h3>
			<p className="secondary mono">
				{rule.scope_globs.length === 0
					? "whole repository"
					: rule.scope_globs.join(", ")}
			</p>

			<h3>Source</h3>
			<p className="mono">
				<a href={rule.source_url} target="_blank" rel="noreferrer">
					#{rule.source_number}
				</a>
			</p>
			{rule.source_comment_urls.length === 0 ? (
				<p className="secondary">No source comments were cited.</p>
			) : (
				<ul className="link-list">
					{rule.source_comment_urls.map((url) => (
						<li key={url}>
							<a href={url} target="_blank" rel="noreferrer">
								{commentLabel(url)}
							</a>
						</li>
					))}
				</ul>
			)}

			<h3>File preview</h3>
			<p className="secondary mono">{rule.file_path}</p>
			<pre>{rule.file_preview}</pre>
		</>
	);
}

export function RuleDrawer({
	ruleId,
	onClose,
}: {
	ruleId: string;
	onClose: () => void;
}) {
	const rule = useRule(ruleId);
	return (
		<Drawer title={rule.data?.directive ?? "Rule"} onClose={onClose}>
			{rule.error && (
				<p className="notice notice-error" role="alert">
					{rule.error.message}
				</p>
			)}
			{rule.isPending && <p className="secondary">Loading…</p>}
			{rule.data && <RuleDrawerView rule={rule.data} />}
		</Drawer>
	);
}
