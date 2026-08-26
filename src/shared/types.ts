import type { RuleType } from "./rule-types.ts";

export type AnalysisState =
	| "unanalysed"
	| "queued"
	| "running"
	| "analysed"
	| "failed";
export type JobKind = "sync" | "analyse" | "promote";
export type JobState = "queued" | "running" | "done" | "failed" | "cancelled";

export type HostRow = {
	id: string;
	label: string;
	api_base: string;
	graphql: string;
	web_base: string;
	token_env: string;
	/** Set when the host left config.yaml. Archived rows keep everything below them. */
	archived_at: string | null;
};

export type RepoRow = {
	id: string;
	host_id: string;
	name: string;
	path_globs: string[];
	default_branch: string;
	window_days: number;
	prompt_template: string | null;
	sync_watermark: string | null;
	created_at: string;
	/** Set when the repo left config.yaml. Archived rows keep their entries and rules. */
	archived_at: string | null;
};

export type PayloadComment = {
	author: string;
	body: string;
	url: string;
	created_at: string;
};

export type PayloadReview = {
	author: string;
	state: string;
	body: string;
	url: string;
	submitted_at: string | null;
};

export type PayloadThread = {
	path: string | null;
	line: number | null;
	resolved: boolean;
	comments: PayloadComment[];
};

/**
 * The analyser's input, deliberately decoupled from GitHub's response shape so a
 * GraphQL change never reaches the prompt or the stored rows.
 */
export type EntryPayload = {
	kind: "pr";
	number: number;
	title: string;
	body: string;
	url: string;
	author: string;
	labels: string[];
	merged_at: string | null;
	updated_at: string;
	changed_paths: string[];
	paths_truncated: boolean;
	/**
	 * True when `reviews`, `review_threads`, `comments`, or `labels` hit its
	 * GraphQL page cap (see the MAX_* constants in core/github/queries.ts) and
	 * so may be missing conversation GitHub actually has. Real pagination past
	 * the caps is a later plan's job; this flag exists so a row synced before
	 * that plan lands is never mistaken for a complete one.
	 */
	conversation_truncated: boolean;
	reviews: PayloadReview[];
	review_threads: PayloadThread[];
	comments: PayloadComment[];
};

/** What the normaliser produces and the store consumes. */
export type NormalisedEntry = {
	number: number;
	title: string;
	author: string;
	url: string;
	merged_at: string | null;
	updated_at: string;
	changed_paths: string[];
	paths_truncated: boolean;
	payload: EntryPayload;
};

export type EntryRow = {
	id: string;
	repo_id: string;
	kind: "pr";
	number: number;
	title: string;
	author: string;
	url: string;
	merged_at: string | null;
	updated_at: string;
	payload: EntryPayload;
	changed_paths: string[];
	paths_truncated: boolean;
	analysis_state: AnalysisState;
	analysed_at: string | null;
	last_error: string | null;
	created_at: string;
};

export type JobRow = {
	id: string;
	kind: JobKind;
	target_id: string;
	state: JobState;
	attempts: number;
	error: string | null;
	created_at: string;
	started_at: string | null;
	finished_at: string | null;
};

export type RuleStatus = "draft" | "proposed" | "verified" | "abandoned";
export type PromotionState = "open" | "merged" | "closed";

export type RuleRow = {
	id: string;
	repo_id: string;
	entry_id: string;
	type: RuleType;
	directive: string;
	rationale: string;
	scope_globs: string[];
	confidence: number;
	source_comment_urls: string[];
	status: RuleStatus;
	promotion_id: string | null;
	/**
	 * The base kebab slug, derived from the directive when the rule is created.
	 * Collision suffixes are applied at promotion time and never written back, so
	 * this stays stable across re-promotion.
	 */
	file_slug: string;
	created_at: string;
	status_changed_at: string;
};

/** What store/rules.ts inserts: an analysed rule plus its derived slug. */
export type NewRule = {
	type: RuleType;
	directive: string;
	rationale: string;
	scope_globs: string[];
	confidence: number;
	source_comment_urls: string[];
	file_slug: string;
};

export type PromotionRow = {
	id: string;
	repo_id: string;
	branch: string;
	pr_number: number | null;
	pr_url: string | null;
	state: PromotionState;
	created_at: string;
	last_checked_at: string | null;
};
