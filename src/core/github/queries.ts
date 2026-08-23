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
			labels(first: 20) { nodes { name } }
			reviews(first: 50) { nodes { author { login } state body url submittedAt } }
			reviewThreads(first: 50) {
				nodes {
					isResolved
					path
					line
					comments(first: 50) { nodes { author { login } body url createdAt } }
				}
			}
			comments(first: 50) { nodes { author { login } body url createdAt } }
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
