import { RefreshCw } from "lucide-react";

export type RepoBarProps = {
	repoName: string;
	/**
	 * `sync_watermark`: the newest `merged_at` this repository has ingested,
	 * which is sync's own pagination floor (src/core/sync/index.ts:205) — NOT
	 * the time of the last sync. A sync that finds no new merges leaves it
	 * where it was, so it is labelled for what it is.
	 */
	syncedAt: string | null;
	onSync: () => void;
	syncing: boolean;
};

/** ISO, not a locale format, to match the dates in the entries table. */
function day(timestamp: string | null): string | null {
	return timestamp === null ? null : timestamp.slice(0, 10);
}

/**
 * Sync is not an app-wide action: it pulls merged pull requests for a single
 * repository, so it belongs on the repository it acts on rather than in the
 * global header beside the brand. This bar sits above the tabs rather than
 * inside one, so it stays reachable from Rules as well as Entries.
 */
export function RepoBar({ repoName, syncedAt, onSync, syncing }: RepoBarProps) {
	const synced = day(syncedAt);
	return (
		<div className="repo-bar">
			<strong className="repo-bar-name">{repoName}</strong>
			<span className="repo-bar-meta">
				{synced === null ? "nothing synced yet" : `merged through ${synced}`}
			</span>
			<span className="spacer" />
			<button type="button" onClick={onSync} disabled={syncing}>
				<RefreshCw className="icon" aria-hidden="true" />
				{syncing ? "Syncing…" : "Sync"}
			</button>
		</div>
	);
}
