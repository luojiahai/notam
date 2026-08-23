import type { Database } from "bun:sqlite";
import type { HostConfig } from "../core/config/schema.ts";
import type { HostRow } from "../shared/types.ts";

/** A host's id comes from config, not from newId — it is the user's own label. */
export function upsertHost(db: Database, host: HostConfig): HostRow {
	db.query(
		`INSERT INTO hosts (id, label, api_base, graphql, token_env)
		 VALUES ($id, $label, $api_base, $graphql, $token_env)
		 ON CONFLICT(id) DO UPDATE SET
		   label = excluded.label,
		   api_base = excluded.api_base,
		   graphql = excluded.graphql,
		   token_env = excluded.token_env`,
	).run({
		$id: host.id,
		$label: host.label,
		$api_base: host.api_base,
		$graphql: host.graphql,
		$token_env: host.token_env,
	});
	const row = getHost(db, host.id);
	if (!row) throw new Error(`host ${host.id} vanished after upsert`);
	return row;
}

export function getHost(db: Database, id: string): HostRow | null {
	return (
		db.query<HostRow, [string]>("SELECT * FROM hosts WHERE id = ?").get(id) ??
		null
	);
}

export function listHosts(db: Database): HostRow[] {
	return db.query<HostRow, []>("SELECT * FROM hosts ORDER BY id").all();
}
