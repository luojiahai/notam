import type { RepoSummary } from "../../../src/shared/api.ts";

export type SidebarProps = {
	repos: RepoSummary[];
	selectedRepoId: string | null;
	onSelectRepo: (repoId: string) => void;
};

/**
 * Which repository, and what is waiting inside it. The counts on each row name
 * one tab apiece — entries, draft rules, open promotions — so the rail answers
 * "where is there work" without opening any of them.
 */
export function Sidebar({ repos, selectedRepoId, onSelectRepo }: SidebarProps) {
	return (
		<nav className="sidebar" aria-label="Repositories">
			<h2>Repositories</h2>
			{repos.length === 0 ? (
				<p className="sidebar-note">
					No repositories configured. Add one to{" "}
					<code>~/.notam/config.yaml</code>.
				</p>
			) : (
				repos.map((repo) => (
					<button
						key={repo.id}
						type="button"
						className="repo"
						aria-current={repo.id === selectedRepoId}
						onClick={() => onSelectRepo(repo.id)}
					>
						<div className="repo-name">{repo.name}</div>
						{/*
							Three figures in pipeline order — what came in, what is
							waiting on a decision, what is in flight — so the rail reads
							as a column of the same three numbers rather than as a
							sentence whose shape changes per row.

							Every figure is present at zero, including the promotions
							one. A pair that appears and disappears moves the two beside
							it, and a column you scan down cannot afford figures that
							shift position between rows.
						*/}
						<div className="repo-meta">
							<span className="repo-stat">
								<b>{repo.entries.total}</b> sources
							</span>
							<span className="repo-stat" data-live={repo.rules.draft > 0}>
								<b>{repo.rules.draft}</b> draft
							</span>
							<span className="repo-stat" data-live={repo.open_promotions > 0}>
								<b>{repo.open_promotions}</b> open
							</span>
						</div>
						{/*
							A repository can be syncing while the user is looking at a
							different one — two run at once by design — so the row says
							so. Without it a background sync is invisible until its
							counts move.
						*/}
						{repo.sync.state !== "idle" && (
							<div className="repo-meta">
								<span className="repo-syncing">
									{repo.sync.state === "running" ? "syncing" : "queued"}
								</span>
							</div>
						)}
					</button>
				))
			)}
		</nav>
	);
}
