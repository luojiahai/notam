import type { PromotionSummary, RepoSummary } from "../../../src/shared/api.ts";
import { StatusPill } from "./Badge.tsx";

export type SidebarProps = {
	repos: RepoSummary[];
	promotions: PromotionSummary[];
	selectedRepoId: string | null;
	onSelectRepo: (repoId: string) => void;
	onRefreshPromotions: () => void;
	refreshing: boolean;
	/** The last refresh failure, verbatim from the server. */
	refreshError?: string | null;
};

/**
 * Spec section 9's sidebar: repositories with entry counts, and below them the
 * promotions with their state badges. Draft count rides along on the repository
 * line because it is the number that tells the user there is work waiting.
 */
export function Sidebar({
	repos,
	promotions,
	selectedRepoId,
	onSelectRepo,
	onRefreshPromotions,
	refreshing,
	refreshError = null,
}: SidebarProps) {
	return (
		<nav className="sidebar" aria-label="Repositories and promotions">
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
						<div className="repo-meta">
							{repo.entries.total} entries · {repo.rules.draft} drafts
						</div>
					</button>
				))
			)}

			<h2>Promotions</h2>
			<div className="sidebar-actions">
				<button
					type="button"
					className="btn-sm"
					onClick={onRefreshPromotions}
					disabled={refreshing}
				>
					{refreshing ? "Refreshing…" : "Refresh status"}
				</button>
				{refreshError && <p className="notice notice-error">{refreshError}</p>}
			</div>
			{promotions.length === 0 ? (
				<p className="sidebar-note">No promotions yet.</p>
			) : (
				<ul className="promotions">
					{promotions.map((promotion) => (
						<li key={promotion.id} className="promotion">
							{promotion.pr_url && promotion.pr_number !== null ? (
								<a
									className="promotion-ref"
									href={promotion.pr_url}
									target="_blank"
									rel="noreferrer"
								>
									#{promotion.pr_number}
								</a>
							) : (
								// No pull request yet, so the branch is the only handle.
								<span
									className="promotion-ref is-branch"
									title={promotion.branch}
								>
									{promotion.branch}
								</span>
							)}
							<StatusPill status={promotion.state} />
							<span className="promotion-count">
								{promotion.rule_count} rule
								{promotion.rule_count === 1 ? "" : "s"}
							</span>
						</li>
					))}
				</ul>
			)}
		</nav>
	);
}
