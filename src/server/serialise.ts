import type { Database } from "bun:sqlite";
import type { PromotionPlan } from "../core/promotion/index.ts";
import { renderRuleFile, rulePath } from "../core/promotion/markdown.ts";
import type { RefreshSummary } from "../core/promotion/refresh.ts";
import { matchedPrefix } from "../core/sync/globs.ts";
import type {
	EntryCounts,
	EntryDetail,
	EntrySummary,
	PromotionPlanView,
	PromotionSummary,
	RefreshSummaryView,
	RepoSummary,
	RuleCounts,
	RuleDetail,
	RuleSummary,
} from "../shared/api.ts";
import type {
	EntryRow,
	HostRow,
	PromotionRow,
	RepoRow,
	RuleRow,
} from "../shared/types.ts";
import { countEntriesByState } from "../store/entries.ts";
import { listPromotions } from "../store/promotions.ts";
import { countRulesByStatus } from "../store/rules.ts";

/**
 * Rows in, wire shapes out, and nothing else. Every route's response goes
 * through here, so a field the UI renders has exactly one definition and one
 * place where it is computed.
 */

/** Reviews, thread comments, and issue comments — everything a human wrote on the PR. */
function conversationSize(entry: EntryRow): number {
	const threadComments = entry.payload.review_threads.reduce(
		(sum, thread) => sum + thread.comments.length,
		0,
	);
	return (
		entry.payload.reviews.length +
		threadComments +
		entry.payload.comments.length
	);
}

/** The zero-filled state counts, plus the total the chips need. */
export function entryCounts(db: Database, repoId: string): EntryCounts {
	const counts = countEntriesByState(db, repoId);
	return {
		total:
			counts.unanalysed +
			counts.queued +
			counts.running +
			counts.analysed +
			counts.failed,
		...counts,
	};
}

export function ruleCounts(db: Database, repoId: string): RuleCounts {
	const counts = countRulesByStatus(db, repoId);
	return {
		total: counts.draft + counts.proposed + counts.verified + counts.abandoned,
		...counts,
	};
}

export function toRepoSummary(
	db: Database,
	repo: RepoRow,
	host: HostRow,
): RepoSummary {
	const open = listPromotions(db, repo.id).filter(
		(promotion) => promotion.state === "open",
	).length;
	return {
		id: repo.id,
		name: repo.name,
		host_id: repo.host_id,
		host_label: host.label,
		default_branch: repo.default_branch,
		path_globs: repo.path_globs,
		window_days: repo.window_days,
		sync_watermark: repo.sync_watermark,
		entries: entryCounts(db, repo.id),
		rules: ruleCounts(db, repo.id),
		open_promotions: open,
	};
}

export function toEntrySummary(
	entry: EntryRow,
	repo: RepoRow,
	ruleCount: number,
	draftRuleCount: number,
): EntrySummary {
	return {
		id: entry.id,
		repo_id: entry.repo_id,
		number: entry.number,
		title: entry.title,
		author: entry.author,
		url: entry.url,
		merged_at: entry.merged_at,
		updated_at: entry.updated_at,
		matched_prefix: matchedPrefix(entry.changed_paths, repo.path_globs),
		changed_file_count: entry.changed_paths.length,
		comment_count: conversationSize(entry),
		paths_truncated: entry.paths_truncated,
		analysis_state: entry.analysis_state,
		analysed_at: entry.analysed_at,
		last_error: entry.last_error,
		rule_count: ruleCount,
		draft_rule_count: draftRuleCount,
	};
}

export function toEntryDetail(
	entry: EntryRow,
	repo: RepoRow,
	rules: RuleRow[],
): EntryDetail {
	const drafts = rules.filter((rule) => rule.status === "draft").length;
	return {
		...toEntrySummary(entry, repo, rules.length, drafts),
		body: entry.payload.body,
		labels: entry.payload.labels,
		changed_paths: entry.changed_paths,
		conversation_truncated: entry.payload.conversation_truncated,
		reviews: entry.payload.reviews,
		review_threads: entry.payload.review_threads,
		comments: entry.payload.comments,
		rules: rules.map((rule) => toRuleSummary(rule, entry)),
	};
}

export function toRuleSummary(rule: RuleRow, entry: EntryRow): RuleSummary {
	return {
		id: rule.id,
		repo_id: rule.repo_id,
		entry_id: rule.entry_id,
		kind: rule.kind,
		directive: rule.directive,
		rationale: rule.rationale,
		scope_globs: rule.scope_globs,
		confidence: rule.confidence,
		source_comment_urls: rule.source_comment_urls,
		status: rule.status,
		promotion_id: rule.promotion_id,
		file_slug: rule.file_slug,
		created_at: rule.created_at,
		status_changed_at: rule.status_changed_at,
		source_number: entry.number,
		source_url: entry.url,
	};
}

/**
 * The drawer's preview uses the rule's *base* slug with no collision suffix:
 * suffixes are assigned per promotion batch, so the honest thing to show
 * outside a promotion is the unsuffixed name, and the collision dialog is
 * where a suffix is disclosed (spec section 7).
 */
export function toRuleDetail(rule: RuleRow, entry: EntryRow): RuleDetail {
	return {
		...toRuleSummary(rule, entry),
		file_path: rulePath(rule.file_slug),
		file_preview: renderRuleFile(rule, entry.url),
	};
}

export function toPromotionSummary(
	promotion: PromotionRow,
	ruleCount: number,
): PromotionSummary {
	return {
		id: promotion.id,
		repo_id: promotion.repo_id,
		branch: promotion.branch,
		pr_number: promotion.pr_number,
		pr_url: promotion.pr_url,
		state: promotion.state,
		created_at: promotion.created_at,
		last_checked_at: promotion.last_checked_at,
		rule_count: ruleCount,
	};
}

export function toPromotionPlanView(plan: PromotionPlan): PromotionPlanView {
	const directives = new Map(
		plan.files.map((file) => [file.rule.id, file.rule.directive]),
	);
	return {
		repo_id: plan.repo.id,
		repo_name: plan.repo.name,
		base_branch: plan.repo.default_branch,
		files: plan.files.map((file) => ({
			rule_id: file.rule.id,
			kind: file.rule.kind,
			directive: file.rule.directive,
			path: file.path,
			content: file.content,
		})),
		collisions: plan.collisions.map((collision) => ({
			rule_id: collision.ruleId,
			directive: directives.get(collision.ruleId) ?? "",
			reason: collision.reason,
			existing: collision.existing,
			path: collision.path,
		})),
	};
}

export function toRefreshSummaryView(
	summary: RefreshSummary,
): RefreshSummaryView {
	return {
		checked: summary.checked,
		merged: summary.merged,
		closed: summary.closed,
		unchanged: summary.unchanged,
		returned_to_draft: summary.returnedToDraft,
		errors: summary.errors.map((error) => ({
			promotion_id: error.promotionId,
			message: error.message,
		})),
	};
}
