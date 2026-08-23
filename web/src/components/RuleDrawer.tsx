import type { RuleDetail } from "../../../src/shared/api.ts";
import { useRule } from "../api/hooks.ts";
import { Badge } from "./Badge.tsx";
import { Drawer } from "./Drawer.tsx";

/** Read-only. Editing a rule's text is out of scope for v1; re-analysis is the recovery path. */
export function RuleDrawerView({ rule }: { rule: RuleDetail }) {
	return (
		<>
			<p>
				<Badge kind={rule.kind}>{rule.kind === "do" ? "DO" : "DON'T"}</Badge>{" "}
				<span className="secondary">
					{rule.status} · confidence {rule.confidence.toFixed(2)}
				</span>
			</p>

			<h3>Rationale</h3>
			<p>{rule.rationale}</p>

			<h3>Scope</h3>
			<p className="secondary">
				{rule.scope_globs.length === 0
					? "whole repository"
					: rule.scope_globs.join(", ")}
			</p>

			<h3>Source</h3>
			<p>
				<a href={rule.source_url} target="_blank" rel="noreferrer">
					#{rule.source_number}
				</a>
			</p>
			{rule.source_comment_urls.length === 0 ? (
				<p className="secondary">No source comments were cited.</p>
			) : (
				<ul>
					{rule.source_comment_urls.map((url) => (
						<li key={url}>
							<a href={url} target="_blank" rel="noreferrer">
								{url.slice(url.indexOf("#"))}
							</a>
						</li>
					))}
				</ul>
			)}

			<h3>File preview</h3>
			<p className="secondary">
				<code>{rule.file_path}</code>
			</p>
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
			{rule.error && <p className="error">{rule.error.message}</p>}
			{rule.isPending && <p className="secondary">Loading…</p>}
			{rule.data && <RuleDrawerView rule={rule.data} />}
		</Drawer>
	);
}
