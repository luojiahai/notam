import { z } from "zod";
import type {
	AnalysisState as RowAnalysisState,
	PromotionState as RowPromotionState,
	RuleKind as RowRuleKind,
	RuleStatus as RowRuleStatus,
} from "./types.ts";

/**
 * The one wire contract. The server validates request bodies against these
 * schemas and the browser validates responses against the same ones, so a field
 * can never mean two things in two places: one schema module, shared by
 * server and frontend.
 *
 * The *composite* shapes here are deliberately not the row types from
 * shared/types.ts — a row is a storage shape, a summary is what a table renders,
 * counts and all. The four small unions below are the opposite case: they must
 * be identical to the row-level ones, so they are inferred from the schemas and
 * pinned to types.ts by PINNED_ENUMS at the bottom of this file.
 */

export const AnalysisStateSchema = z.enum([
	"unanalysed",
	"queued",
	"running",
	"analysed",
	"failed",
]);
export const RuleKindSchema = z.enum(["do", "dont"]);
export const RuleStatusSchema = z.enum([
	"draft",
	"proposed",
	"verified",
	"abandoned",
]);
export const PromotionStateSchema = z.enum(["open", "merged", "closed"]);

export type AnalysisState = z.infer<typeof AnalysisStateSchema>;
export type RuleKind = z.infer<typeof RuleKindSchema>;
export type RuleStatus = z.infer<typeof RuleStatusSchema>;
export type PromotionState = z.infer<typeof PromotionStateSchema>;

/** True only when A and B are the same union, in both directions. */
type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;

/**
 * Compile-time proof that the wire enums and the row unions have not drifted.
 * Adding a state to one and not the other turns this into a type error instead
 * of a runtime surprise three layers away. Exported only so `noUnusedLocals`
 * does not delete the guard.
 */
export const PINNED_ENUMS: [
	Exact<AnalysisState, RowAnalysisState>,
	Exact<RuleKind, RowRuleKind>,
	Exact<RuleStatus, RowRuleStatus>,
	Exact<PromotionState, RowPromotionState>,
] = [true, true, true, true];

const count = z.number().int().min(0);

/** Zero-filled by the server so every filter chip can render a number. */
export const EntryCountsSchema = z.object({
	total: count,
	unanalysed: count,
	queued: count,
	running: count,
	analysed: count,
	failed: count,
});

export const RuleCountsSchema = z.object({
	total: count,
	draft: count,
	proposed: count,
	verified: count,
	abandoned: count,
});

/**
 * The counts a sync reports: the same four whether it is still walking pages or
 * has finished, so a live tally and the total it settles on cannot drift apart.
 */
export const SyncTotalsSchema = z.object({
	scanned: count,
	created: count,
	updated: count,
	skipped: count,
});

/** What sync is doing for a repository right now. `idle` means no job is pending. */
export const SyncStateSchema = z.enum(["idle", "queued", "running"]);

/** How a sync ended. `cancelled` is the user's own stop press, not a failure. */
export const SyncOutcomeSchema = z.enum(["done", "failed", "cancelled"]);

export const RepoSyncSchema = z.object({
	state: SyncStateSchema,
	/** When the job was claimed. Null unless `state` is `running`. */
	started_at: z.string().nullable(),
	/**
	 * How the last sync of this repository ended, or null if it has never run
	 * one to a conclusion. Survives a reload, which is the point: the browser
	 * learns this from the job table rather than from an event it may have
	 * missed.
	 */
	last: z
		.object({
			outcome: SyncOutcomeSchema,
			at: z.string(),
			error: z.string().nullable(),
		})
		.nullable(),
});

export const RepoSummarySchema = z.object({
	id: z.string(),
	name: z.string(),
	host_id: z.string(),
	host_label: z.string(),
	/** Where this repository is browsed, on whichever host serves it. */
	url: z.string(),
	default_branch: z.string(),
	path_globs: z.array(z.string()),
	window_days: z.number().int(),
	sync_watermark: z.string().nullable(),
	entries: EntryCountsSchema,
	rules: RuleCountsSchema,
	open_promotions: count,
	sync: RepoSyncSchema,
});

export const EntrySummarySchema = z.object({
	id: z.string(),
	repo_id: z.string(),
	number: z.number().int(),
	title: z.string(),
	author: z.string(),
	url: z.string(),
	merged_at: z.string().nullable(),
	updated_at: z.string(),
	/** The first configured glob this PR's files matched, for the row's second line. */
	matched_prefix: z.string().nullable(),
	changed_file_count: count,
	comment_count: count,
	paths_truncated: z.boolean(),
	analysis_state: AnalysisStateSchema,
	analysed_at: z.string().nullable(),
	last_error: z.string().nullable(),
	rule_count: count,
	/**
	 * Only the drafts, because only drafts are discarded by a re-analysis. This
	 * is the number the confirmation dialog has to say out loud.
	 */
	draft_rule_count: count,
});

export const PayloadCommentSchema = z.object({
	author: z.string(),
	body: z.string(),
	url: z.string(),
	created_at: z.string(),
});

export const PayloadReviewSchema = z.object({
	author: z.string(),
	state: z.string(),
	body: z.string(),
	url: z.string(),
	submitted_at: z.string().nullable(),
});

export const PayloadThreadSchema = z.object({
	path: z.string().nullable(),
	line: z.number().int().nullable(),
	resolved: z.boolean(),
	comments: z.array(PayloadCommentSchema),
});

export const RuleSummarySchema = z.object({
	id: z.string(),
	repo_id: z.string(),
	entry_id: z.string(),
	kind: RuleKindSchema,
	directive: z.string(),
	rationale: z.string(),
	scope_globs: z.array(z.string()),
	confidence: z.number(),
	source_comment_urls: z.array(z.string()),
	status: RuleStatusSchema,
	promotion_id: z.string().nullable(),
	file_slug: z.string(),
	created_at: z.string(),
	status_changed_at: z.string(),
	/** Provenance, denormalised so the rules table needs no second request. */
	source_number: z.number().int(),
	source_url: z.string(),
});

export const RuleDetailSchema = RuleSummarySchema.extend({
	/** The exact path the file would be committed to, base slug, no collision suffix. */
	file_path: z.string(),
	/** The exact bytes of that file, rendered by core/promotion/markdown.ts. */
	file_preview: z.string(),
});

export const EntryDetailSchema = EntrySummarySchema.extend({
	body: z.string(),
	labels: z.array(z.string()),
	changed_paths: z.array(z.string()),
	conversation_truncated: z.boolean(),
	reviews: z.array(PayloadReviewSchema),
	review_threads: z.array(PayloadThreadSchema),
	comments: z.array(PayloadCommentSchema),
	rules: z.array(RuleSummarySchema),
});

export const PromotionSummarySchema = z.object({
	id: z.string(),
	repo_id: z.string(),
	branch: z.string(),
	pr_number: z.number().int().nullable(),
	pr_url: z.string().nullable(),
	state: PromotionStateSchema,
	created_at: z.string(),
	last_checked_at: z.string().nullable(),
	rule_count: count,
});

export const CollisionSchema = z.object({
	rule_id: z.string(),
	directive: z.string(),
	reason: z.enum(["base-branch", "batch"]),
	existing: z.string(),
	path: z.string(),
});

export const PlannedFileSchema = z.object({
	rule_id: z.string(),
	kind: RuleKindSchema,
	directive: z.string(),
	path: z.string(),
	content: z.string(),
});

export const PromotionPlanSchema = z.object({
	repo_id: z.string(),
	repo_name: z.string(),
	base_branch: z.string(),
	files: z.array(PlannedFileSchema),
	collisions: z.array(CollisionSchema),
});

export const RefreshSummarySchema = z.object({
	checked: count,
	merged: count,
	closed: count,
	unchanged: count,
	returned_to_draft: count,
	errors: z.array(z.object({ promotion_id: z.string(), message: z.string() })),
});

export const MetaSchema = z.object({
	version: z.string(),
	config_path: z.string(),
	db_path: z.string(),
	claude_available: z.boolean(),
	/** Rendered as a dismissible banner. A missing claude CLI lands here. */
	warnings: z.array(z.string()),
	analysis: z.object({
		concurrency: z.number().int(),
		timeout_seconds: z.number().int(),
		model: z.string().nullable(),
	}),
});

export const QueueResultSchema = z.object({
	queued: z.array(z.string()),
	skipped: z.array(z.string()),
});

/**
 * `skipped` is an entry that had nothing pending — a stop press that arrived
 * after the work finished on its own. An outcome, never an error.
 */
export const CancelResultSchema = z.object({
	cancelled: z.array(z.string()),
	skipped: z.array(z.string()),
});

/**
 * No `skipped` counterpart: nothing was named by the caller, so nothing can be
 * reported absent.
 */
export const RepoAnalyseCancelledSchema = z.object({
	cancelled: z.array(z.string()),
});

export const SyncStartedSchema = z.object({
	job_id: z.string().nullable(),
	/** True when a sync for this repository was already queued or running. */
	already_running: z.boolean(),
});

export const SyncCancelledSchema = z.object({
	/** False when nothing was pending. A no-op, never an error. */
	cancelled: z.boolean(),
});

/**
 * List endpoints return their rows *and* the unfiltered counts, because the
 * filter chips must keep showing "Failed 3" while the Unanalysed filter is on.
 */
export const EntriesResponseSchema = z.object({
	entries: z.array(EntrySummarySchema),
	counts: EntryCountsSchema,
});

export const RulesResponseSchema = z.object({
	rules: z.array(RuleSummarySchema),
	counts: RuleCountsSchema,
});

export const ApiErrorSchema = z.object({
	error: z.object({ message: z.string() }),
});

/* ---------- requests ---------- */

const idList = z.array(z.string().min(1)).min(1);

export const AnalyseRequestSchema = z.object({ entry_ids: idList });

/**
 * `proposed` and `draft` are absent on purpose. A rule becomes `proposed` only
 * by being promoted, and returns to `draft` only when the status refresh finds
 * its pull request closed — neither is a button.
 */
export const RuleStatusRequestSchema = z.object({
	rule_ids: idList,
	status: z.enum(["verified", "abandoned"]),
});

export const PromotionRequestSchema = z.object({
	rule_ids: idList,
	title: z.string().min(1).optional(),
});

export const RefreshRequestSchema = z.object({
	repo_id: z.string().min(1).optional(),
});

/* ---------- server-sent events ---------- */

export const ServerEventSchema = z.discriminatedUnion("type", [
	z.object({ type: z.literal("hello"), version: z.string() }),
	z.object({ type: z.literal("heartbeat") }),
	z.object({
		type: z.literal("entry"),
		repo_id: z.string(),
		entry_id: z.string(),
		state: AnalysisStateSchema,
		error: z.string().nullable(),
	}),
	/**
	 * `progress` carries the running totals of a sync still walking pages,
	 * throttled per repository, so it is a live tally rather than one event per
	 * pull request. There is no total to divide by — GitHub's listing is
	 * cursor-paginated with no count — so it is a rising count, never a
	 * percentage.
	 */
	z.object({
		type: z.literal("sync"),
		repo_id: z.string(),
		phase: z.enum(["started", "progress", "finished", "failed", "cancelled"]),
		...SyncTotalsSchema.shape,
		error: z.string().nullable(),
	}),
	z.object({ type: z.literal("rules"), repo_id: z.string() }),
	z.object({
		type: z.literal("promotion"),
		repo_id: z.string(),
		promotion_id: z.string(),
		state: PromotionStateSchema,
	}),
]);

export type EntryCounts = z.infer<typeof EntryCountsSchema>;
export type RuleCounts = z.infer<typeof RuleCountsSchema>;
export type RepoSummary = z.infer<typeof RepoSummarySchema>;
export type EntrySummary = z.infer<typeof EntrySummarySchema>;
export type EntryDetail = z.infer<typeof EntryDetailSchema>;
export type RuleSummary = z.infer<typeof RuleSummarySchema>;
export type RuleDetail = z.infer<typeof RuleDetailSchema>;
export type PromotionSummary = z.infer<typeof PromotionSummarySchema>;
export type Collision = z.infer<typeof CollisionSchema>;
export type PlannedFileView = z.infer<typeof PlannedFileSchema>;
export type PromotionPlanView = z.infer<typeof PromotionPlanSchema>;
export type RefreshSummaryView = z.infer<typeof RefreshSummarySchema>;
export type Meta = z.infer<typeof MetaSchema>;
export type QueueResult = z.infer<typeof QueueResultSchema>;
export type CancelResult = z.infer<typeof CancelResultSchema>;
export type RepoAnalyseCancelled = z.infer<typeof RepoAnalyseCancelledSchema>;
export type SyncStarted = z.infer<typeof SyncStartedSchema>;
export type SyncCancelled = z.infer<typeof SyncCancelledSchema>;
export type RepoSync = z.infer<typeof RepoSyncSchema>;
export type SyncTotals = z.infer<typeof SyncTotalsSchema>;
export type SyncState = z.infer<typeof SyncStateSchema>;
export type SyncOutcome = z.infer<typeof SyncOutcomeSchema>;
export type EntriesResponse = z.infer<typeof EntriesResponseSchema>;
export type RulesResponse = z.infer<typeof RulesResponseSchema>;
export type ServerEvent = z.infer<typeof ServerEventSchema>;
