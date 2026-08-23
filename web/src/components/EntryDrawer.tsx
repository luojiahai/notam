import { useState } from "react";
import type { EntryDetail } from "../../../src/shared/api.ts";
import { useEntry } from "../api/hooks.ts";
import { Badge } from "./Badge.tsx";
import { Dialog } from "./Dialog.tsx";
import { Drawer } from "./Drawer.tsx";

export function EntryDrawerView({
	entry,
	onReanalyse,
	onOpenRule,
}: {
	entry: EntryDetail;
	onReanalyse: () => void;
	onOpenRule: (ruleId: string) => void;
}) {
	const [confirming, setConfirming] = useState(false);

	/**
	 * Spec section 6 requires the draft count on the row menu, in this drawer,
	 * and on the bulk action alike, so the guard lives with each entry point
	 * rather than at the one the user happened to reach first.
	 */
	const requestReanalyse = () => {
		if (entry.draft_rule_count > 0) {
			setConfirming(true);
			return;
		}
		onReanalyse();
	};

	return (
		<>
			<p className="secondary">
				<a href={entry.url} target="_blank" rel="noreferrer">
					#{entry.number}
				</a>{" "}
				by {entry.author}
				{entry.labels.length > 0 && ` · ${entry.labels.join(", ")}`}
			</p>

			{entry.analysis_state === "failed" ? (
				<p className="error">
					{entry.last_error}{" "}
					<button type="button" onClick={requestReanalyse}>
						Retry
					</button>
				</p>
			) : (
				<button type="button" onClick={requestReanalyse}>
					Re-analyse
				</button>
			)}

			{confirming && (
				<Dialog
					title="Re-analyse"
					confirmLabel="Re-analyse"
					onCancel={() => setConfirming(false)}
					onConfirm={() => {
						setConfirming(false);
						onReanalyse();
					}}
				>
					<p>
						This will discard {entry.draft_rule_count} draft rule
						{entry.draft_rule_count === 1 ? "" : "s"} and re-run analysis.
					</p>
					<p className="secondary">
						Proposed, verified, and abandoned rules are untouched, and the
						stored pull request payload is reused — re-sync first if the
						conversation has changed.
					</p>
				</Dialog>
			)}

			<h3>Description</h3>
			<p style={{ whiteSpace: "pre-wrap" }}>
				{entry.body || "(no description)"}
			</p>

			<h3>Rules from this entry</h3>
			{entry.rules.length === 0 ? (
				<p className="secondary">No rules yet.</p>
			) : (
				<ul style={{ listStyle: "none", padding: 0 }}>
					{entry.rules.map((rule) => (
						<li key={rule.id} style={{ padding: "0.25rem 0" }}>
							<Badge kind={rule.kind}>
								{rule.kind === "do" ? "DO" : "DON'T"}
							</Badge>{" "}
							<button
								type="button"
								style={{
									background: "none",
									border: 0,
									padding: 0,
									textAlign: "left",
								}}
								onClick={() => onOpenRule(rule.id)}
							>
								{rule.directive}
							</button>{" "}
							<span className="secondary">{rule.status}</span>
						</li>
					))}
				</ul>
			)}

			<h3>Review submissions</h3>
			{entry.reviews.length === 0 ? (
				<p className="secondary">None.</p>
			) : (
				entry.reviews.map((review) => (
					<div key={review.url} style={{ marginBottom: "0.5rem" }}>
						<div className="secondary">
							{review.author} · {review.state}
						</div>
						<div style={{ whiteSpace: "pre-wrap" }}>{review.body}</div>
					</div>
				))
			)}

			<h3>Review threads</h3>
			{entry.review_threads.length === 0 ? (
				<p className="secondary">None.</p>
			) : (
				entry.review_threads.map((thread, index) => (
					<div
						key={thread.comments[0]?.url ?? `thread-${index}`}
						style={{ marginBottom: "0.75rem" }}
					>
						<div className="secondary">
							{/* The file and line anchor is what makes a thread's advice scopeable. */}
							<span>
								{thread.path
									? `${thread.path}${thread.line === null ? "" : `:${thread.line}`}`
									: "(not anchored to a file)"}
							</span>
							{thread.resolved && " · resolved"}
						</div>
						{thread.comments.map((comment) => (
							<div key={comment.url}>
								<span className="secondary">{comment.author}: </span>
								<a href={comment.url} target="_blank" rel="noreferrer">
									{comment.body}
								</a>
							</div>
						))}
					</div>
				))
			)}

			<h3>Comments</h3>
			{entry.comments.length === 0 ? (
				<p className="secondary">None.</p>
			) : (
				entry.comments.map((comment) => (
					<div key={comment.url}>
						<span className="secondary">{comment.author}: </span>
						{comment.body}
					</div>
				))
			)}

			<h3>Changed files ({entry.changed_file_count})</h3>
			{entry.paths_truncated && (
				<p className="warning">
					This pull request changed more than 300 files, so the list below is
					truncated and any scope inferred from it is incomplete.
				</p>
			)}
			{entry.conversation_truncated && (
				<p className="warning">
					The stored conversation is truncated: this pull request has more
					reviews, threads, or comments than one sync page holds.
				</p>
			)}
			<ul className="secondary">
				{entry.changed_paths.map((path) => (
					<li key={path}>
						<code>{path}</code>
					</li>
				))}
			</ul>
		</>
	);
}

export function EntryDrawer({
	entryId,
	onClose,
	onReanalyse,
	onOpenRule,
}: {
	entryId: string;
	onClose: () => void;
	onReanalyse: (entryId: string) => void;
	onOpenRule: (ruleId: string) => void;
}) {
	const entry = useEntry(entryId);
	return (
		<Drawer title={entry.data?.title ?? "Entry"} onClose={onClose}>
			{entry.error && <p className="error">{entry.error.message}</p>}
			{entry.isPending && <p className="secondary">Loading…</p>}
			{entry.data && (
				<EntryDrawerView
					entry={entry.data}
					onReanalyse={() => onReanalyse(entryId)}
					onOpenRule={onOpenRule}
				/>
			)}
		</Drawer>
	);
}
