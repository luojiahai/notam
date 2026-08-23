export type AnalysisState =
	| "unanalysed"
	| "queued"
	| "running"
	| "analysed"
	| "failed";
export type JobKind = "sync" | "analyse" | "promote";
export type JobState = "queued" | "running" | "done" | "failed";

export type HostRow = {
	id: string;
	label: string;
	api_base: string;
	graphql: string;
	token_env: string;
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
	 * that plan lands is never mistaken for a complete one — see finding I3.
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
