/** Spec section 5: a PR's file list is capped, and exceeding it is recorded, never hidden. */
export const MAX_CHANGED_PATHS = 300;

export type RepoRef = { owner: string; name: string };

export function parseRepoName(name: string): RepoRef {
	const [owner, repo] = name.split("/");
	if (!owner || !repo)
		throw new Error(`repository name must be owner/repo, got "${name}"`);
	return { owner, name: repo };
}

/** GitHub returns null for a deleted user, on both github.com and GHES. */
export type RawActor = { login: string } | null;

export type RawComment = {
	author: RawActor;
	body: string | null;
	url: string;
	createdAt: string;
};

export type RawReview = {
	author: RawActor;
	state: string;
	body: string | null;
	url: string;
	submittedAt: string | null;
};

export type RawThread = {
	isResolved: boolean;
	path: string | null;
	line: number | null;
	comments: { nodes: (RawComment | null)[] | null } | null;
};

export type RawPullRequest = {
	number: number;
	title: string;
	body: string | null;
	url: string;
	updatedAt: string;
	mergedAt: string | null;
	author: RawActor;
	labels: { nodes: ({ name: string } | null)[] | null } | null;
	reviews: { nodes: (RawReview | null)[] | null } | null;
	reviewThreads: { nodes: (RawThread | null)[] | null } | null;
	comments: { nodes: (RawComment | null)[] | null } | null;
};

/** One row from the cheap listing query. */
export type PRRef = {
	number: number;
	updatedAt: string;
	mergedAt: string | null;
};

export type PRPage = {
	nodes: PRRef[];
	endCursor: string | null;
	hasNextPage: boolean;
};

/** A hydrated PR: the node, plus the file list resolved across its own pages. */
export type PRDetail = {
	pullRequest: RawPullRequest;
	changedPaths: string[];
	pathsTruncated: boolean;
};

export interface GitHubClient {
	listMergedPRs(
		repo: RepoRef,
		options: { cursor?: string; pageSize?: number },
	): Promise<PRPage>;
	fetchPRDetail(repo: RepoRef, number: number): Promise<PRDetail>;
}
