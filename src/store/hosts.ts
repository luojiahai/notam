import type { Database } from "bun:sqlite";
import type { HostConfig } from "../core/config/schema.ts";
import type { HostRow } from "../shared/types.ts";

/**
 * A host's id comes from config, not from newId — it is the user's own label.
 *
 * Re-adding a host that was archived un-archives it rather than creating a
 * second row, so a host removed from config.yaml and put back keeps every repo
 * beneath it.
 */
export function upsertHost(db: Database, host: HostConfig): HostRow {
	db.query(
		`INSERT INTO hosts (id, label, api_base, graphql, web_base, token_env, archived_at)
		 VALUES ($id, $label, $api_base, $graphql, $web_base, $token_env, NULL)
		 ON CONFLICT(id) DO UPDATE SET
		   label = excluded.label,
		   api_base = excluded.api_base,
		   graphql = excluded.graphql,
		   web_base = excluded.web_base,
		   token_env = excluded.token_env,
		   archived_at = NULL`,
	).run({
		$id: host.id,
		$label: host.label,
		$api_base: host.api_base,
		$graphql: host.graphql,
		$web_base: host.web_base,
		$token_env: host.token_env,
	});
	const row = getHost(db, host.id);
	if (!row) throw new Error(`host ${host.id} vanished after upsert`);
	return row;
}

/** Finds a host whether or not it is archived; the lifecycle routes need both. */
export function getHost(db: Database, id: string): HostRow | null {
	return (
		db.query<HostRow, [string]>("SELECT * FROM hosts WHERE id = ?").get(id) ??
		null
	);
}

export function listHosts(db: Database): HostRow[] {
	return db
		.query<HostRow, []>(
			"SELECT * FROM hosts WHERE archived_at IS NULL ORDER BY id",
		)
		.all();
}

export function listArchivedHosts(db: Database): HostRow[] {
	return db
		.query<HostRow, []>(
			"SELECT * FROM hosts WHERE archived_at IS NOT NULL ORDER BY id",
		)
		.all();
}

export function archiveHost(db: Database, id: string, now: Date): void {
	db.query(
		"UPDATE hosts SET archived_at = ? WHERE id = ? AND archived_at IS NULL",
	).run(now.toISOString(), id);
}

/** Deletes the host and, through the schema's cascade, everything under it. */
export function purgeHost(db: Database, id: string): void {
	db.query("DELETE FROM hosts WHERE id = ?").run(id);
}

/**
 * Changes a host's id while its repositories follow it.
 *
 * A host's id is its primary key and `repos.host_id` references it, so this
 * cannot be a single UPDATE: the new row is inserted, the repos are moved onto
 * it, and only then is the old row dropped — by which point the cascade has
 * nothing left to take.
 */
export function renameHost(db: Database, id: string, nextId: string): void {
	db.transaction(() => {
		db.query(
			`INSERT INTO hosts (id, label, api_base, graphql, web_base, token_env, archived_at)
			 SELECT $next, label, api_base, graphql, web_base, token_env, archived_at
			 FROM hosts WHERE id = $id`,
		).run({ $next: nextId, $id: id });
		db.query("UPDATE repos SET host_id = ? WHERE host_id = ?").run(nextId, id);
		db.query("DELETE FROM hosts WHERE id = ?").run(id);
	})();
}
