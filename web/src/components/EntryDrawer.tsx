import { Sparkles, Square } from "lucide-react";
import { useState } from "react";
import type { EntryDetail } from "../../../src/shared/api.ts";
import { RULE_TYPE_LABELS } from "../../../src/shared/rule-types.ts";
import { useEntry } from "../api/hooks.ts";
import { isBusy } from "../lib/analysis.ts";
import { Badge, StatusPill } from "./Badge.tsx";
import { Dialog } from "./Dialog.tsx";
import { Drawer } from "./Drawer.tsx";

/**
 * GitHub's review states arrive as SCREAMING_SNAKE enums. They are rendered as
 * prose with a semantic tint, because "CHANGES_REQUESTED" is the one word on
 * this screen that changes how you read everything under it.
 */
const REVIEW_STATES: Record<string, { label: string; tone: string }> = {
	APPROVED: { label: "approved", tone: "status-verified" },
	CHANGES_REQUESTED: { label: "changes requested", tone: "status-failed" },
	COMMENTED: { label: "commented", tone: "" },
	DISMISSED: { label: "dismissed", tone: "status-abandoned" },
	PENDING: { label: "pending", tone: "" },
};

function ReviewState({ state }: { state: string }) {
	// Unknown states are shown verbatim rather than swallowed: GitHub can add
	// one, and a blank pill would hide it.
	const known = REVIEW_STATES[state];
	return (
		<span className={`status ${known?.tone ?? ""}`}>
			{known?.label ?? state.toLowerCase().replace(/_/g, " ")}
		</span>
	);
}

export function EntryDrawerView({
	entry,
	onReanalyse,
	onCancel,
	onOpenRule,
}: {
	entry: EntryDetail;
	onReanalyse: () => void;
	onCancel: () => void;
	onOpenRule: (ruleId: string) => void;
}) {
	const [confirming, setConfirming] = useState(false);

	/**
	 * The draft count belongs on the row action, in this drawer, and on the bulk
	 * action alike, so the guard lives with each entry point rather than at the
	 * one the user happened to reach first.
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
			<p className="meta-line">
				<a className="mono" href={entry.url} target="_blank" rel="noreferrer">
					#{entry.number}
				</a>
				<span>by {entry.author}</span>
				{entry.labels.length > 0 && <span>{entry.labels.join(", ")}</span>}
			</p>

			{/*
				The only place this text is readable, and it is process output
				rather than prose: `pre` keeps the line breaks `claude` printed,
				and the height cap stops a long trace from pushing the rest of
				the drawer past the fold.
			*/}
			{entry.analysis_state === "failed" && (
				<pre className="notice notice-error notice-trace">
					{entry.last_error}
				</pre>
			)}

			{/*
				The pair the row has, labelled rather than icon-only: the reason
				the row abbreviates its Stop is that a column of them would read
				as identical buttons, and there is no column here.
			*/}
			<div className="drawer-actions">
				<button
					type="button"
					disabled={isBusy(entry)}
					onClick={requestReanalyse}
				>
					<Sparkles className="icon" aria-hidden="true" />
					Analyse
				</button>
				<button type="button" disabled={!isBusy(entry)} onClick={onCancel}>
					<Square className="icon" aria-hidden="true" />
					Stop
				</button>
			</div>

			{confirming && (
				<Dialog
					title="Analyse"
					confirmLabel="Analyse"
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
						Proposed, verified, and abandoned rules are untouched. The stored
						pull request payload is reused, so re-sync first if the conversation
						has changed.
					</p>
				</Dialog>
			)}

			<h3>Description</h3>
			<p className="prose">{entry.body || "No description."}</p>

			<h3>Rules from this entry</h3>
			{entry.rules.length === 0 ? (
				<p className="secondary">No rules yet.</p>
			) : (
				<ul className="rule-list">
					{entry.rules.map((rule) => (
						<li key={rule.id}>
							<Badge>{RULE_TYPE_LABELS[rule.type]}</Badge>
							<button
								type="button"
								className="btn-plain"
								onClick={() => onOpenRule(rule.id)}
							>
								{rule.directive}
							</button>
							<StatusPill status={rule.status} />
						</li>
					))}
				</ul>
			)}

			<h3>Review submissions</h3>
			{entry.reviews.length === 0 ? (
				<p className="secondary">None.</p>
			) : (
				entry.reviews.map((review) => (
					<div className="quote" key={review.url}>
						<div className="quote-head">
							<span className="quote-author">{review.author}</span>
							<ReviewState state={review.state} />
						</div>
						<div className="quote-body">{review.body}</div>
					</div>
				))
			)}

			<h3>Review threads</h3>
			{entry.review_threads.length === 0 ? (
				<p className="secondary">None.</p>
			) : (
				entry.review_threads.map((thread, index) => (
					<div
						className="quote"
						key={thread.comments[0]?.url ?? `thread-${index}`}
					>
						<div className="quote-head">
							{/* The file and line anchor is what makes a thread's advice scopeable. */}
							<span className="quote-anchor">
								{thread.path
									? `${thread.path}${thread.line === null ? "" : `:${thread.line}`}`
									: "(not anchored to a file)"}
							</span>
							{thread.resolved && <span className="status">resolved</span>}
						</div>
						{thread.comments.map((comment) => (
							<div className="quote-comment" key={comment.url}>
								<a
									className="quote-author"
									href={comment.url}
									target="_blank"
									rel="noreferrer"
								>
									{comment.author}
								</a>
								<span className="quote-body">{comment.body}</span>
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
					<div className="quote" key={comment.url}>
						<div className="quote-head">
							<a
								className="quote-author"
								href={comment.url}
								target="_blank"
								rel="noreferrer"
							>
								{comment.author}
							</a>
						</div>
						<div className="quote-body">{comment.body}</div>
					</div>
				))
			)}

			<h3>Changed files ({entry.changed_file_count})</h3>
			{entry.paths_truncated && (
				<p className="notice notice-warn">
					This pull request changed more than 300 files, so the list below is
					truncated and any scope inferred from it is incomplete.
				</p>
			)}
			{entry.conversation_truncated && (
				<p className="notice notice-warn">
					The stored conversation is truncated: this pull request has more
					reviews, threads, or comments than one sync page holds.
				</p>
			)}
			<ul className="path-list">
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
	onCancel,
	onOpenRule,
}: {
	entryId: string;
	onClose: () => void;
	onReanalyse: (entryId: string) => void;
	onCancel: (entryId: string) => void;
	onOpenRule: (ruleId: string) => void;
}) {
	const entry = useEntry(entryId);
	return (
		<Drawer title={entry.data?.title ?? "Entry"} onClose={onClose}>
			{entry.error && (
				<p className="notice notice-error" role="alert">
					{entry.error.message}
				</p>
			)}
			{entry.isPending && <p className="secondary">Loading…</p>}
			{entry.data && (
				<EntryDrawerView
					entry={entry.data}
					onReanalyse={() => onReanalyse(entryId)}
					onCancel={() => onCancel(entryId)}
					onOpenRule={onOpenRule}
				/>
			)}
		</Drawer>
	);
}
