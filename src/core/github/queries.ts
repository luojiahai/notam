/**
 * Per-PR conversation caps. `normalisePR` sets `EntryPayload.conversation_truncated`
 * when any of the corresponding arrays reaches its cap, so under-capture is
 * recorded rather than silently dropped. Pagination past these caps is a later
 * plan's job — see the truncation flag's own doc comment in shared/types.ts.
 */
export const MAX_REVIEWS = 50;
export const MAX_COMMENTS = 50;
export const MAX_REVIEW_THREADS = 50;
export const MAX_LABELS = 20;

/**
 * Listing is deliberately thin — number and timestamps only. Hydration is a
 * separate query per PR, which is what keeps a several-hundred-PR backfill near
 * one API call per PR instead of the four or five REST would need.
 */
export const LIST_MERGED_PRS = `
query ListMergedPRs($owner: String!, $name: String!, $pageSize: Int!, $cursor: String) {
	repository(owner: $owner, name: $name) {
		pullRequests(states: [MERGED], orderBy: { field: UPDATED_AT, direction: DESC }, first: $pageSize, after: $cursor) {
			pageInfo { hasNextPage endCursor }
			nodes { number updatedAt mergedAt }
		}
	}
	rateLimit { remaining resetAt }
}`;

export const PULL_REQUEST_DETAIL = `
query PullRequestDetail($owner: String!, $name: String!, $number: Int!) {
	repository(owner: $owner, name: $name) {
		pullRequest(number: $number) {
			number
			title
			body
			url
			updatedAt
			mergedAt
			author { login }
			labels(first: ${MAX_LABELS}) { nodes { name } }
			reviews(first: ${MAX_REVIEWS}) { nodes { author { login } state body url submittedAt } }
			reviewThreads(first: ${MAX_REVIEW_THREADS}) {
				nodes {
					isResolved
					path
					line
					comments(first: 50) { nodes { author { login } body url createdAt } }
				}
			}
			comments(first: ${MAX_COMMENTS}) { nodes { author { login } body url createdAt } }
			files(first: 100) {
				pageInfo { hasNextPage endCursor }
				nodes { path }
			}
		}
	}
	rateLimit { remaining resetAt }
}`;

/** Pages 2 and 3 of a large PR's file list, without refetching the conversation. */
export const PULL_REQUEST_FILES = `
query PullRequestFiles($owner: String!, $name: String!, $number: Int!, $filesCursor: String!) {
	repository(owner: $owner, name: $name) {
		pullRequest(number: $number) {
			files(first: 100, after: $filesCursor) {
				pageInfo { hasNextPage endCursor }
				nodes { path }
			}
		}
	}
	rateLimit { remaining resetAt }
}`;
