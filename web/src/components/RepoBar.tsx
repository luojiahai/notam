import { ArrowDownToLine, Square } from "lucide-react";
import type { RepoSync } from "../../../src/shared/api.ts";
import type { SyncProgress } from "../App.tsx";
import { GithubMark } from "./GithubMark.tsx";

export type RepoBarProps = {
	repoName: string;
	/** Composed by the server, so an Enterprise host links to its own site. */
	repoUrl: string;
	/**
	 * `sync_watermark`: the newest `merged_at` this repository has ingested,
	 * which is sync's own pagination floor — NOT the time of the last sync. A
	 * sync that finds no new merges leaves it where it was, so it is labelled
	 * for what it is.
	 */
	syncedAt: string | null;
	/** Server-authoritative, so a reload mid-sync still shows the sync. */
	sync: RepoSync;
	/** Running totals of a sync in flight, or null before its first tick. */
	progress: SyncProgress | null;
	onSync: () => void;
	onCancelSync: () => void;
};

/** ISO, not a locale format, to match the dates in the entries table. */
function day(timestamp: string | null): string | null {
	return timestamp === null ? null : timestamp.slice(0, 10);
}

/**
 * What the disabled Sync button says about itself. Being mid-sync and being
 * queued behind another repository are different facts, and a button that goes
 * down without saying which leaves the user guessing.
 */
function disabledReason(state: RepoSync["state"]): string | undefined {
	if (state === "running") return "This repository is already syncing";
	if (state === "queued") return "A sync for this repository is already queued";
	return undefined;
}

/** `scanned` leads because it is the figure that moves through a repeat run. */
function tally(progress: SyncProgress): string {
	const fresh = progress.created + progress.updated;
	return `${progress.scanned} scanned · ${fresh} stored`;
}

/** A finished sync needs no epitaph; the watermark beside it already says so. */
function lastOutcome(
	sync: RepoSync,
): { outcome: "failed" | "cancelled"; label: string } | null {
	if (!sync.last) return null;
	if (sync.last.outcome === "failed")
		return { outcome: "failed", label: "last sync failed" };
	if (sync.last.outcome === "cancelled")
		return { outcome: "cancelled", label: "last sync stopped" };
	return null;
}

/**
 * Sync is not an app-wide action: it pulls merged pull requests for a single
 * repository, so it belongs on the repository it acts on rather than in the
 * global header beside the brand. This bar sits above the tabs rather than
 * inside one, so it stays reachable from Rules as well as Entries.
 *
 * Sync and Stop are two controls rather than one that changes verb under the
 * cursor: a button whose meaning flips in place is a misclick waiting to
 * happen, and the two actions are not opposites of equal weight.
 */
export function RepoBar({
	repoName,
	repoUrl,
	syncedAt,
	sync,
	progress,
	onSync,
	onCancelSync,
}: RepoBarProps) {
	const synced = day(syncedAt);
	const pending = sync.state !== "idle";
	const outcome = lastOutcome(sync);
	return (
		<div className="repo-bar">
			{/*
				The name and the link to it are one thing, so they sit closer
				than the bar's own gap: everything about the state of a sync is
				at the other end, beside the buttons that cause it.
			*/}
			<div className="repo-bar-title">
				<strong className="repo-bar-name">{repoName}</strong>
				<a
					className="btn-icon"
					href={repoUrl}
					target="_blank"
					rel="noreferrer"
					aria-label={`${repoName} on GitHub`}
					title={`${repoName} on GitHub`}
				>
					<GithubMark className="icon" />
				</a>
			</div>
			<span className="spacer" />
			<span className="repo-bar-meta">
				{synced === null ? "nothing synced yet" : `merged through ${synced}`}
			</span>
			{pending && (
				<span className="repo-bar-meta repo-bar-progress" aria-live="polite">
					{sync.state === "queued"
						? "queued"
						: progress
							? tally(progress)
							: "scanning…"}
				</span>
			)}
			{outcome && (
				// A stop the user asked for is not painted as an error; only a
				// genuine failure takes the error colour.
				<span
					className="repo-bar-meta repo-bar-outcome"
					data-outcome={outcome.outcome}
				>
					{outcome.label}
				</span>
			)}
			{pending && (
				<button type="button" onClick={onCancelSync}>
					<Square className="icon" aria-hidden="true" />
					Stop
				</button>
			)}
			<button
				type="button"
				onClick={onSync}
				disabled={pending}
				title={disabledReason(sync.state)}
			>
				<ArrowDownToLine className="icon" aria-hidden="true" />
				{sync.state === "running" ? "Syncing…" : "Sync"}
			</button>
		</div>
	);
}
