import type { Database } from "bun:sqlite";
import type { RepoConfig } from "../core/config/schema.ts";
import { newId } from "../shared/ids.ts";
import type { RepoRow } from "../shared/types.ts";

type RawRepo = {
	id: string;
	host_id: string;
	name: string;
	path_globs: string;
	default_branch: string;
	window_days: number;
	prompt_template: string | null;
	sync_watermark: string | null;
	created_at: string;
};

function hydrate(raw: RawRepo): RepoRow {
	return { ...raw, path_globs: JSON.parse(raw.path_globs) as string[] };
}

/**
 * Config is the source of truth for everything except `sync_watermark`, which is
 * owned by sync and must survive a re-read of config.yaml.
 */
export function upsertRepo(
	db: Database,
	hostId: string,
	repo: RepoConfig,
	now: Date,
): RepoRow {
	const existing = getRepoByName(db, hostId, repo.name);
	const id = existing?.id ?? newId("r", now.getTime());
	db.query(
		`INSERT INTO repos (id, host_id, name, path_globs, default_branch, window_days, prompt_template, created_at)
		 VALUES ($id, $host_id, $name, $path_globs, $default_branch, $window_days, $prompt_template, $created_at)
		 ON CONFLICT(host_id, name) DO UPDATE SET
		   path_globs = excluded.path_globs,
		   default_branch = excluded.default_branch,
		   window_days = excluded.window_days,
		   prompt_template = excluded.prompt_template`,
	).run({
		$id: id,
		$host_id: hostId,
		$name: repo.name,
		$path_globs: JSON.stringify(repo.path_globs),
		$default_branch: repo.default_branch,
		$window_days: repo.window_days,
		$prompt_template: repo.prompt_template ?? null,
		$created_at: now.toISOString(),
	});
	const row = getRepoByName(db, hostId, repo.name);
	if (!row) throw new Error(`repo ${repo.name} vanished after upsert`);
	return row;
}

export function getRepo(db: Database, id: string): RepoRow | null {
	const raw = db
		.query<RawRepo, [string]>("SELECT * FROM repos WHERE id = ?")
		.get(id);
	return raw ? hydrate(raw) : null;
}

export function getRepoByName(
	db: Database,
	hostId: string,
	name: string,
): RepoRow | null {
	const raw = db
		.query<RawRepo, [string, string]>(
			"SELECT * FROM repos WHERE host_id = ? AND name = ?",
		)
		.get(hostId, name);
	return raw ? hydrate(raw) : null;
}

export function listRepos(db: Database): RepoRow[] {
	return db
		.query<RawRepo, []>("SELECT * FROM repos ORDER BY host_id, name")
		.all()
		.map(hydrate);
}

export function setWatermark(
	db: Database,
	repoId: string,
	watermark: string,
): void {
	db.query("UPDATE repos SET sync_watermark = ? WHERE id = ?").run(
		watermark,
		repoId,
	);
}
