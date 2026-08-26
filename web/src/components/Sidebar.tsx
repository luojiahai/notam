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
							A repository can be syncing while the user is looking at a
							different one — two run at once by design — so the row says
							so. Without it a background sync is invisible until its
							counts move.
						*/}
						<div className="repo-meta">
							{repo.entries.total} entries · {repo.rules.draft} drafts
							{/*
								Omitted at zero rather than shown as "0 open promotions":
								a repository nobody has promoted from is the quiet case,
								and the row is read by scanning down a column.
							*/}
							{repo.open_promotions > 0 && (
								<>
									{" · "}
									{repo.open_promotions} open promotion
									{repo.open_promotions === 1 ? "" : "s"}
								</>
							)}
							{repo.sync.state !== "idle" && (
								<>
									{" · "}
									<span className="repo-syncing">
										{repo.sync.state === "running" ? "syncing" : "queued"}
									</span>
								</>
							)}
						</div>
					</button>
				))
			)}
		</nav>
	);
}
