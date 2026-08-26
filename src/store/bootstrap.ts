import type { Database } from "bun:sqlite";
import type { Config } from "../core/config/schema.ts";
import type { HostRow, RepoRow } from "../shared/types.ts";
import { archiveHost, listHosts, upsertHost } from "./hosts.ts";
import { archiveRepo, listRepos, upsertRepo } from "./repos.ts";

/**
 * Reconciles config.yaml into the hosts and repos tables.
 *
 * Absence is archival, never deletion. Entries, rules, and promotions cascade
 * from these rows, so a repo removed from the file — by a form, by a text
 * editor, by a checkout of someone else's dotfiles — must not be able to take
 * months of verified rules with it. Re-adding it un-archives the same row, so
 * the round trip is lossless.
 *
 * A host archived here takes no repos with it directly: config cannot name a
 * repo whose host is absent, so those repos are already missing from the file
 * and archive on their own.
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

		const keptHosts = new Set(hosts.map((host) => host.id));
		for (const host of listHosts(db)) {
			if (!keptHosts.has(host.id)) archiveHost(db, host.id, now);
		}

		const keptRepos = new Set(repos.map((repo) => repo.id));
		for (const repo of listRepos(db)) {
			if (!keptRepos.has(repo.id)) archiveRepo(db, repo.id, now);
		}

		return { hosts, repos };
	})();
}
