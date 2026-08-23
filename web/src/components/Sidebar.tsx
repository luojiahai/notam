import type { PromotionSummary, RepoSummary } from "../../../src/shared/api.ts";
import { Badge } from "./Badge.tsx";

export type SidebarProps = {
	repos: RepoSummary[];
	promotions: PromotionSummary[];
	selectedRepoId: string | null;
	onSelectRepo: (repoId: string) => void;
	onRefreshPromotions: () => void;
	refreshing: boolean;
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
}: SidebarProps) {
	return (
		<nav className="sidebar" aria-label="Repositories and promotions">
			<h2>Repositories</h2>
			{repos.length === 0 ? (
				<p className="secondary" style={{ padding: "0 0.5rem" }}>
					No repositories configured. Add one to{" "}
					<code>~/.notam/config.yaml</code>.
				</p>
			) : (
				repos.map((repo) => (
					<button
						key={repo.id}
						type="button"
						aria-current={repo.id === selectedRepoId}
						onClick={() => onSelectRepo(repo.id)}
					>
						<div>{repo.name}</div>
						<div className="secondary">
							{repo.entries.total} entries · {repo.rules.draft} drafts
						</div>
					</button>
				))
			)}

			<h2>Promotions</h2>
			<div style={{ padding: "0 0.5rem 0.5rem" }}>
				<button
					type="button"
					onClick={onRefreshPromotions}
					disabled={refreshing}
				>
					{refreshing ? "Refreshing…" : "Refresh status"}
				</button>
			</div>
			{promotions.length === 0 ? (
				<p className="secondary" style={{ padding: "0 0.5rem" }}>
					No promotions yet.
				</p>
			) : (
				<ul style={{ listStyle: "none", margin: 0, padding: "0 0.5rem" }}>
					{promotions.map((promotion) => (
						<li key={promotion.id} style={{ padding: "0.25rem 0" }}>
							{promotion.pr_url && promotion.pr_number !== null ? (
								<a href={promotion.pr_url} target="_blank" rel="noreferrer">
									#{promotion.pr_number}
								</a>
							) : (
								<span className="secondary">{promotion.branch}</span>
							)}{" "}
							<Badge>{promotion.state}</Badge>
							<div className="secondary">{promotion.rule_count} rules</div>
						</li>
					))}
				</ul>
			)}
		</nav>
	);
}
