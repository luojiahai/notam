import type { Database } from "bun:sqlite";
import { newId } from "../../shared/ids.ts";
import type {
	HostRow,
	PromotionRow,
	RepoRow,
	RuleRow,
} from "../../shared/types.ts";
import { getEntry } from "../../store/entries.ts";
import { getHost } from "../../store/hosts.ts";
import { insertPromotion } from "../../store/promotions.ts";
import { getRepo } from "../../store/repos.ts";
import { getRule, listRulesByIds } from "../../store/rules.ts";
import { type GitDataClient, parseRepoName } from "../github/types.ts";
import { resolveSlugs } from "../rules/slug.ts";
import { canTransition, transitionRules } from "../rules/state.ts";
import {
	type PRBodyItem,
	promotionTitle,
	renderPRBody,
	renderRuleFile,
	rulePath,
} from "./markdown.ts";

export class PromotionError extends Error {
	override name = "PromotionError";
}

export type PlannedFile = {
	rule: RuleRow;
	slug: string;
	path: string;
	content: string;
	sourceUrl: string;
	sourceNumber: number;
};

/** What the confirmation dialog renders, per spec section 7's pre-flight. */
export type Collision = {
	ruleId: string;
	reason: "base-branch" | "batch";
	/** The file that was already taken. */
	existing: string;
	/** The suffixed file that would be committed instead. */
	path: string;
};

export type PromotionPlan = {
	repo: RepoRow;
	host: HostRow;
	files: PlannedFile[];
	collisions: Collision[];
};

export type PromotionDeps = {
	db: Database;
	clientFor: (host: HostRow) => GitDataClient;
	now: () => Date;
	/** The branch name's disambiguating tail. Injected so tests are deterministic. */
	suffix?: () => string;
};

function yyyymmdd(date: Date): string {
	return date.toISOString().slice(0, 10).replace(/-/g, "");
}

/**
 * The pre-flight. Reads `.claude/rules/` on the base branch, assigns final file
 * names, and reports every collision rather than silently committing a second
 * file — spec section 7 calls the silent version a footgun, and it is.
 *
 * Reads only. Nothing here changes a rule.
 */
export async function planPromotion(
	deps: PromotionDeps,
	ruleIds: string[],
): Promise<PromotionPlan> {
	if (ruleIds.length === 0) {
		throw new PromotionError("Select at least one rule to promote.");
	}

	const rules = listRulesByIds(deps.db, ruleIds);
	const found = new Set(rules.map((rule) => rule.id));
	const missing = ruleIds.filter((id) => !found.has(id));
	if (missing.length > 0) {
		throw new PromotionError(`No rule with id ${missing.join(", ")}`);
	}

	const repoIds = [...new Set(rules.map((rule) => rule.repo_id))];
	if (repoIds.length > 1) {
		throw new PromotionError(
			"A promotion targets a single repository, but the selection spans " +
				`${repoIds.length}. Select rules from one repository at a time.`,
		);
	}

	const notDraft = rules.filter((rule) => rule.status !== "draft");
	if (notDraft.length > 0) {
		throw new PromotionError(
			`Only draft rules can be promoted. ${notDraft
				.map((rule) => `${rule.id} is ${rule.status}`)
				.join(", ")}`,
		);
	}

	const repoId = repoIds[0] as string;
	const repo = getRepo(deps.db, repoId);
	if (!repo) throw new PromotionError(`No repository with id ${repoId}`);
	const host = getHost(deps.db, repo.host_id);
	if (!host) {
		throw new PromotionError(
			`repo ${repo.name} references unknown host "${repo.host_id}"`,
		);
	}

	const client = deps.clientFor(host);
	const taken = await client.listRuleFiles(
		parseRepoName(repo.name),
		repo.default_branch,
	);
	const assignments = resolveSlugs(
		rules.map((rule) => rule.file_slug),
		taken,
	);

	const files: PlannedFile[] = [];
	const collisions: Collision[] = [];

	rules.forEach((rule, index) => {
		const assignment = assignments[index];
		if (!assignment)
			throw new PromotionError(`no slug assigned for ${rule.id}`);
		const entry = getEntry(deps.db, rule.entry_id);
		if (!entry) {
			throw new PromotionError(
				`rule ${rule.id} references unknown entry ${rule.entry_id}`,
			);
		}
		const path = rulePath(assignment.slug);
		files.push({
			rule,
			slug: assignment.slug,
			path,
			content: renderRuleFile(rule, entry.url),
			sourceUrl: entry.url,
			sourceNumber: entry.number,
		});
		if (assignment.collided !== null) {
			collisions.push({
				ruleId: rule.id,
				reason: assignment.collided,
				existing: rulePath(rule.file_slug),
				path,
			});
		}
	});

	return { repo, host, files, collisions };
}

/**
 * The irreversible half. The GitHub call happens first and nothing is written
 * until it returns: a failed push therefore leaves every rule `draft` with
 * nothing half-committed, exactly as spec section 7 requires.
 */
export async function promoteRules(
	deps: PromotionDeps,
	plan: PromotionPlan,
	options: { title?: string } = {},
): Promise<PromotionRow> {
	if (plan.files.length === 0) {
		throw new PromotionError("This promotion has no files to commit.");
	}

	const suffix = deps.suffix ?? (() => newId("b").slice(-6).toLowerCase());
	const timestamp = deps.now();
	const branch = `notam/rules-${yyyymmdd(timestamp)}-${suffix()}`;
	const title = options.title ?? promotionTitle(plan.files.length);
	const items: PRBodyItem[] = plan.files.map((file) => ({
		rule: file.rule,
		path: file.path,
		sourceUrl: file.sourceUrl,
		sourceNumber: file.sourceNumber,
	}));

	// A cheap re-read immediately before the network call, not after it: the
	// plan forbids re-validating after createPRWithFiles (that cannot close the
	// dialog-to-confirm race either), but a check here costs nothing and
	// narrows that race from dialog-duration to sub-millisecond by catching the
	// common case — a rule abandoned while the dialog sat open — before any
	// pull request is opened.
	for (const file of plan.files) {
		const current = getRule(deps.db, file.rule.id);
		if (!current) {
			throw new PromotionError(
				`rule ${file.rule.id} no longer exists and cannot be promoted`,
			);
		}
		if (!canTransition(current.status, "proposed")) {
			throw new PromotionError(
				`rule ${current.id} cannot move from ${current.status} to proposed`,
			);
		}
	}

	const client = deps.clientFor(plan.host);
	const created = await client.createPRWithFiles(
		parseRepoName(plan.repo.name),
		{
			baseBranch: plan.repo.default_branch,
			branch,
			message: title,
			title,
			body: renderPRBody(items),
			files: plan.files.map((file) => ({
				path: file.path,
				content: file.content,
			})),
		},
	);

	return deps.db.transaction(() => {
		const promotion = insertPromotion(
			deps.db,
			{
				repo_id: plan.repo.id,
				branch: created.branch,
				pr_number: created.number,
				pr_url: created.url,
			},
			timestamp,
		);
		transitionRules(
			deps.db,
			plan.files.map((file) => file.rule.id),
			"proposed",
			timestamp,
			{ promotionId: promotion.id },
		);
		return promotion;
	})();
}
