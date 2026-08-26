import type { Database } from "bun:sqlite";
import type {
	EntryRow,
	HostRow,
	PromotionRow,
	RepoRow,
	RuleRow,
} from "../shared/types.ts";
import { getEntry } from "../store/entries.ts";
import { getHost } from "../store/hosts.ts";
import { getPromotion } from "../store/promotions.ts";
import { getRepo } from "../store/repos.ts";
import { getRule } from "../store/rules.ts";
import { HttpError } from "./errors.ts";

/**
 * Path parameters come from a URL, so "not found" is a 404 and not a crash.
 * Collected here so no route re-invents the message.
 *
 * An archived repository is a 404 to everything but the lifecycle routes:
 * entries, rules, promotions, and sync are all views of a repository the user
 * still has, and a tab left open across an archive would otherwise keep
 * operating on one they removed.
 */
export function requireRepo(db: Database, id: string): RepoRow {
	const repo = getRepo(db, id);
	if (!repo || repo.archived_at !== null) {
		throw new HttpError(404, `No repository with id ${id}`);
	}
	return repo;
}

export function requireHost(db: Database, id: string): HostRow {
	const host = getHost(db, id);
	if (!host) throw new HttpError(404, `No host with id ${id}`);
	return host;
}

/** Restore, purge, and rename exist precisely to act on an archived row. */
export function requireAnyRepo(db: Database, id: string): RepoRow {
	const repo = getRepo(db, id);
	if (!repo) throw new HttpError(404, `No repository with id ${id}`);
	return repo;
}

export function requireEntry(db: Database, id: string): EntryRow {
	const entry = getEntry(db, id);
	if (!entry) throw new HttpError(404, `No entry with id ${id}`);
	return entry;
}

export function requireRule(db: Database, id: string): RuleRow {
	const rule = getRule(db, id);
	if (!rule) throw new HttpError(404, `No rule with id ${id}`);
	return rule;
}

export function requirePromotion(db: Database, id: string): PromotionRow {
	const promotion = getPromotion(db, id);
	if (!promotion) throw new HttpError(404, `No promotion with id ${id}`);
	return promotion;
}
