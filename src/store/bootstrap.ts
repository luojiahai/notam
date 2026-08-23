import type { Database } from "bun:sqlite";
import type { Config } from "../core/config/schema.ts";
import type { HostRow, RepoRow } from "../shared/types.ts";
import { upsertHost } from "./hosts.ts";
import { upsertRepo } from "./repos.ts";

/**
 * Reconciles config.yaml into the hosts and repos tables. Additive by design:
 * a repo removed from config keeps its rows, because its entries and rules are
 * user data and deleting them must be an explicit action.
 */
export function applyConfig(
	db: Database,
	config: Config,
	now: Date,
): { hosts: HostRow[]; repos: RepoRow[] } {
	return db.transaction(() => {
		const hosts = config.hosts.map((host) => upsertHost(db, host));
		const repos = config.repos.map((repo) =>
			upsertRepo(db, repo.host, repo, now),
		);
		return { hosts, repos };
	})();
}
