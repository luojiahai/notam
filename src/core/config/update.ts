import type { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { applyConfig } from "../../store/bootstrap.ts";
import * as hosts from "../../store/hosts.ts";
import * as repos from "../../store/repos.ts";
import {
	ConfigConflictError,
	ConfigError,
	ConfigValidationError,
	configHash,
	expandHome,
	parseConfig,
} from "./load.ts";
import { type Config, ConfigSchema } from "./schema.ts";
import { renderConfig, writeConfigFileSync } from "./write.ts";

export type ConfigWrite = {
	db: Database;
	path: string;
	/** Whatever the caller submitted, before validation. */
	next: unknown;
	/** The hash the caller's edit was based on. */
	expectedHash: string;
	now: Date;
	/** Resolves `~` in a repo's prompt_template. */
	home: string;
};

export type ConfigResult = { config: Config; hash: string };

/**
 * Refuses a write built on a version of the file that is no longer there.
 *
 * config.yaml is editable by hand and by the settings drawer at the same time,
 * and the drawer's document is a snapshot. Without this, saving a form would
 * silently paste over whatever someone had just typed into the file.
 */
async function assertUnchanged(path: string, expected: string): Promise<void> {
	const file = Bun.file(path);
	if (!(await file.exists())) {
		throw new ConfigError(`No config file at ${path}`);
	}
	if (configHash(await file.text()) !== expected) {
		throw new ConfigConflictError(
			`${path} changed on disk since it was read. Reload the settings and apply the edit again.`,
		);
	}
}

/** A prompt template that is not there fails an analysis job hours later; catch it at save time. */
function assertPromptTemplatesExist(config: Config, home: string): void {
	for (const repo of config.repos) {
		if (repo.prompt_template === undefined) continue;
		if (!existsSync(expandHome(repo.prompt_template, home))) {
			throw new ConfigValidationError(
				`Prompt template not found for ${repo.name}: ${repo.prompt_template}`,
			);
		}
	}
}

/**
 * The one path by which config.yaml and the database both change.
 *
 * Two stores and no transaction spanning them, so the database's write
 * transaction is held across the file replacement: a failed write rolls the
 * rows back, and both stores are left untouched rather than disagreeing. A
 * crash in the gap between the rename and the commit leaves the file ahead of
 * the database, which the next boot reconciles anyway — the file is the source
 * of truth, and applyConfig re-derives from it every time.
 */
export async function updateConfig(write: ConfigWrite): Promise<ConfigResult> {
	await assertUnchanged(write.path, write.expectedHash);

	// Not safeParse: a ZodError is the honest answer to a malformed submission,
	// and the server maps it to 400 with the field paths intact.
	const config = ConfigSchema.parse(write.next);
	assertPromptTemplatesExist(config, write.home);

	return commit(write.db, write.path, config, write.now);
}

function commit(
	db: Database,
	path: string,
	config: Config,
	now: Date,
): ConfigResult {
	const contents = renderConfig(config);
	db.transaction(() => {
		applyConfig(db, config, now);
		writeConfigFileSync(path, contents);
	})();
	return { config, hash: configHash(contents) };
}

export type RenameWrite = {
	db: Database;
	path: string;
	id: string;
	next: string;
	expectedHash: string;
	now: Date;
};

/**
 * Renames a repository without it reading as a removal.
 *
 * A repo's identity in config.yaml is `(host, name)`, so editing the name in
 * the file archives one row and creates an empty other. The store rename runs
 * first, inside the same transaction, so the row applyConfig then matches is
 * the original — watermark, entries, and rules included.
 */
export async function renameRepo(write: RenameWrite): Promise<ConfigResult> {
	await assertUnchanged(write.path, write.expectedHash);

	const repo = repos.getRepo(write.db, write.id);
	if (!repo)
		throw new ConfigValidationError(`No repository with id ${write.id}`);
	if (repos.getRepoByName(write.db, repo.host_id, write.next)) {
		throw new ConfigValidationError(
			`${repo.host_id} already has a repository called ${write.next}`,
		);
	}

	const current = parseConfig(await Bun.file(write.path).text(), write.path);
	const config = ConfigSchema.parse({
		...current,
		repos: current.repos.map((entry) =>
			entry.host === repo.host_id && entry.name === repo.name
				? { ...entry, name: write.next }
				: entry,
		),
	});

	const contents = renderConfig(config);
	write.db.transaction(() => {
		repos.renameRepo(write.db, write.id, write.next);
		applyConfig(write.db, config, write.now);
		writeConfigFileSync(write.path, contents);
	})();
	return { config, hash: configHash(contents) };
}

/** The same trade as renameRepo, one level up: repos follow the host across. */
export async function renameHost(write: RenameWrite): Promise<ConfigResult> {
	await assertUnchanged(write.path, write.expectedHash);

	const host = hosts.getHost(write.db, write.id);
	if (!host) throw new ConfigValidationError(`No host with id ${write.id}`);
	if (hosts.getHost(write.db, write.next)) {
		throw new ConfigValidationError(
			`A host called ${write.next} already exists`,
		);
	}

	const current = parseConfig(await Bun.file(write.path).text(), write.path);
	const config = ConfigSchema.parse({
		...current,
		hosts: current.hosts.map((entry) =>
			entry.id === write.id ? { ...entry, id: write.next } : entry,
		),
		repos: current.repos.map((entry) =>
			entry.host === write.id ? { ...entry, host: write.next } : entry,
		),
	});

	const contents = renderConfig(config);
	write.db.transaction(() => {
		hosts.renameHost(write.db, write.id, write.next);
		applyConfig(write.db, config, write.now);
		writeConfigFileSync(write.path, contents);
	})();
	return { config, hash: configHash(contents) };
}

/**
 * Destroys an archived repository and everything that cascades from it.
 *
 * Only an archived one: a repository still named in config.yaml would be
 * recreated empty by the next boot, which reads as data loss with extra steps.
 */
export function purgeRepo(db: Database, id: string): void {
	const repo = repos.getRepo(db, id);
	if (!repo) throw new ConfigValidationError(`No repository with id ${id}`);
	if (repo.archived_at === null) {
		throw new ConfigValidationError(
			`${repo.name} is still in config.yaml. Remove it there first — it is archived, not deleted, and can be restored until you delete it here.`,
		);
	}
	repos.purgeRepo(db, id);
}

export function purgeHost(db: Database, id: string): void {
	const host = hosts.getHost(db, id);
	if (!host) throw new ConfigValidationError(`No host with id ${id}`);
	if (host.archived_at === null) {
		throw new ConfigValidationError(
			`${host.id} is still in config.yaml. Remove it there first — it is archived, not deleted, and can be restored until you delete it here.`,
		);
	}
	hosts.purgeHost(db, id);
}
