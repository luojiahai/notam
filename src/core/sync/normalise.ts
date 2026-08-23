import type {
	NormalisedEntry,
	PayloadComment,
	PayloadReview,
	PayloadThread,
} from "../../shared/types.ts";
import type {
	PRDetail,
	RawActor,
	RawComment,
	RawReview,
	RawThread,
} from "../github/types.ts";

/** GraphQL connections are nullable at every level; this flattens one safely. */
function nodesOf<T>(
	connection: { nodes: (T | null)[] | null } | null | undefined,
): T[] {
	return (connection?.nodes ?? []).filter((node): node is T => node !== null);
}

function loginOf(actor: RawActor): string {
	return actor?.login ?? "ghost";
}

function isoOf(timestamp: string): string {
	return new Date(timestamp).toISOString();
}

function isoOrNull(timestamp: string | null): string | null {
	return timestamp === null ? null : isoOf(timestamp);
}

function comment(raw: RawComment): PayloadComment {
	return {
		author: loginOf(raw.author),
		body: raw.body ?? "",
		url: raw.url,
		created_at: isoOf(raw.createdAt),
	};
}

function review(raw: RawReview): PayloadReview {
	return {
		author: loginOf(raw.author),
		state: raw.state,
		body: raw.body ?? "",
		url: raw.url,
		submitted_at: isoOrNull(raw.submittedAt),
	};
}

function thread(raw: RawThread): PayloadThread {
	return {
		path: raw.path,
		line: raw.line,
		resolved: raw.isResolved,
		comments: nodesOf<RawComment>(raw.comments).map(comment),
	};
}

/**
 * GraphQL response -> the storage and analyser shape. This is the only place
 * that knows GitHub's field names, which is what lets the rest of NOTAM survive
 * a schema change upstream.
 */
export function normalisePR(detail: PRDetail): NormalisedEntry {
	const pr = detail.pullRequest;
	const author = loginOf(pr.author);
	const updated_at = isoOf(pr.updatedAt);
	const merged_at = isoOrNull(pr.mergedAt);

	return {
		number: pr.number,
		title: pr.title,
		author,
		url: pr.url,
		merged_at,
		updated_at,
		changed_paths: detail.changedPaths,
		paths_truncated: detail.pathsTruncated,
		payload: {
			kind: "pr",
			number: pr.number,
			title: pr.title,
			body: pr.body ?? "",
			url: pr.url,
			author,
			labels: nodesOf<{ name: string }>(pr.labels).map((label) => label.name),
			merged_at,
			updated_at,
			changed_paths: detail.changedPaths,
			paths_truncated: detail.pathsTruncated,
			reviews: nodesOf<RawReview>(pr.reviews).map(review),
			review_threads: nodesOf<RawThread>(pr.reviewThreads).map(thread),
			comments: nodesOf<RawComment>(pr.comments).map(comment),
		},
	};
}
