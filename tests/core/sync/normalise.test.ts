import { describe, expect, test } from "bun:test";
import {
	MAX_COMMENTS,
	MAX_LABELS,
	MAX_REVIEW_THREADS,
	MAX_REVIEWS,
} from "../../../src/core/github/queries.ts";
import type {
	PRDetail,
	RawPullRequest,
} from "../../../src/core/github/types.ts";
import { normalisePR } from "../../../src/core/sync/normalise.ts";

function pullRequest(overrides: Partial<RawPullRequest> = {}): RawPullRequest {
	return {
		number: 4821,
		title: "Fix rounding in payments",
		body: "Rounds half-up to match the ledger.",
		url: "https://github.com/acme/mono/pull/4821",
		updatedAt: "2026-08-21T10:00:00Z",
		mergedAt: "2026-08-20T10:00:00Z",
		author: { login: "dana" },
		labels: { nodes: [{ name: "bug" }, { name: "payments" }] },
		reviews: {
			nodes: [
				{
					author: { login: "kim" },
					state: "CHANGES_REQUESTED",
					body: "Needs a regression test.",
					url: "https://github.com/acme/mono/pull/4821#pullrequestreview-1",
					submittedAt: "2026-08-19T09:00:00Z",
				},
			],
		},
		reviewThreads: {
			nodes: [
				{
					isResolved: true,
					path: "services/payments/round.ts",
					line: 42,
					comments: {
						nodes: [
							{
								author: { login: "kim" },
								body: "Always add a regression test alongside a bug fix.",
								url: "https://github.com/acme/mono/pull/4821#discussion_r1",
								createdAt: "2026-08-19T09:01:00Z",
							},
						],
					},
				},
			],
		},
		comments: {
			nodes: [
				{
					author: { login: "dana" },
					body: "Test added.",
					url: "https://github.com/acme/mono/pull/4821#issuecomment-1",
					createdAt: "2026-08-19T10:00:00Z",
				},
			],
		},
		...overrides,
	};
}

function detail(overrides: Partial<PRDetail> = {}): PRDetail {
	return {
		pullRequest: pullRequest(),
		changedPaths: [
			"services/payments/round.ts",
			"services/payments/round.test.ts",
		],
		pathsTruncated: false,
		...overrides,
	};
}

describe("normalisePR", () => {
	test("lifts the columns the entries table needs", () => {
		const entry = normalisePR(detail());
		expect(entry.number).toBe(4821);
		expect(entry.title).toBe("Fix rounding in payments");
		expect(entry.author).toBe("dana");
		expect(entry.url).toBe("https://github.com/acme/mono/pull/4821");
		expect(entry.changed_paths).toEqual([
			"services/payments/round.ts",
			"services/payments/round.test.ts",
		]);
		expect(entry.paths_truncated).toBe(false);
	});

	test("normalises timestamps to ISO 8601 with milliseconds", () => {
		const entry = normalisePR(detail());
		expect(entry.updated_at).toBe("2026-08-21T10:00:00.000Z");
		expect(entry.merged_at).toBe("2026-08-20T10:00:00.000Z");
	});

	test("carries the full conversation into the payload", () => {
		const { payload } = normalisePR(detail());
		expect(payload.kind).toBe("pr");
		expect(payload.body).toBe("Rounds half-up to match the ledger.");
		expect(payload.labels).toEqual(["bug", "payments"]);
		expect(payload.reviews).toHaveLength(1);
		expect(payload.reviews[0]?.state).toBe("CHANGES_REQUESTED");
		expect(payload.comments[0]?.body).toBe("Test added.");
	});

	test("keeps each review thread's file and line anchor", () => {
		const { payload } = normalisePR(detail());
		expect(payload.review_threads[0]?.path).toBe("services/payments/round.ts");
		expect(payload.review_threads[0]?.line).toBe(42);
		expect(payload.review_threads[0]?.resolved).toBe(true);
		expect(payload.review_threads[0]?.comments[0]?.url).toBe(
			"https://github.com/acme/mono/pull/4821#discussion_r1",
		);
	});

	test("replaces a deleted author with ghost rather than crashing", () => {
		const entry = normalisePR(
			detail({ pullRequest: pullRequest({ author: null }) }),
		);
		expect(entry.author).toBe("ghost");
		expect(entry.payload.author).toBe("ghost");
	});

	test("turns a null body into an empty string", () => {
		const entry = normalisePR(
			detail({ pullRequest: pullRequest({ body: null }) }),
		);
		expect(entry.payload.body).toBe("");
	});

	test("tolerates every connection being null, as older GHES returns", () => {
		const entry = normalisePR(
			detail({
				pullRequest: pullRequest({
					labels: null,
					reviews: null,
					reviewThreads: null,
					comments: null,
				}),
			}),
		);
		expect(entry.payload.labels).toEqual([]);
		expect(entry.payload.reviews).toEqual([]);
		expect(entry.payload.review_threads).toEqual([]);
		expect(entry.payload.comments).toEqual([]);
	});

	test("drops null nodes that GraphQL emits for inaccessible records", () => {
		const entry = normalisePR(
			detail({
				pullRequest: pullRequest({
					labels: { nodes: [null, { name: "bug" }] },
					comments: { nodes: [null] },
				}),
			}),
		);
		expect(entry.payload.labels).toEqual(["bug"]);
		expect(entry.payload.comments).toEqual([]);
	});

	test("records truncation on the entry and inside the payload", () => {
		const entry = normalisePR(detail({ pathsTruncated: true }));
		expect(entry.paths_truncated).toBe(true);
		expect(entry.payload.paths_truncated).toBe(true);
	});

	test("keeps merged_at null for a PR that is somehow not merged", () => {
		const entry = normalisePR(
			detail({ pullRequest: pullRequest({ mergedAt: null }) }),
		);
		expect(entry.merged_at).toBeNull();
		expect(entry.payload.merged_at).toBeNull();
	});

	test("produces a payload that survives a JSON round trip unchanged", () => {
		const { payload } = normalisePR(detail());
		expect(JSON.parse(JSON.stringify(payload))).toEqual(payload);
	});

	describe("conversation_truncated", () => {
		test("is false when every conversation array is below its cap", () => {
			const { payload } = normalisePR(detail());
			expect(payload.reviews.length).toBeLessThan(MAX_REVIEWS);
			expect(payload.comments.length).toBeLessThan(MAX_COMMENTS);
			expect(payload.review_threads.length).toBeLessThan(MAX_REVIEW_THREADS);
			expect(payload.labels.length).toBeLessThan(MAX_LABELS);
			expect(payload.conversation_truncated).toBe(false);
		});

		test("is true when reviews reach their cap", () => {
			const reviews = Array.from({ length: MAX_REVIEWS }, (_, i) => ({
				author: { login: "kim" },
				state: "APPROVED",
				body: `review ${i}`,
				url: `https://github.com/acme/mono/pull/4821#pullrequestreview-${i}`,
				submittedAt: "2026-08-19T09:00:00Z",
			}));
			const { payload } = normalisePR(
				detail({ pullRequest: pullRequest({ reviews: { nodes: reviews } }) }),
			);
			expect(payload.conversation_truncated).toBe(true);
		});

		test("is true when comments reach their cap", () => {
			const comments = Array.from({ length: MAX_COMMENTS }, (_, i) => ({
				author: { login: "dana" },
				body: `comment ${i}`,
				url: `https://github.com/acme/mono/pull/4821#issuecomment-${i}`,
				createdAt: "2026-08-19T10:00:00Z",
			}));
			const { payload } = normalisePR(
				detail({
					pullRequest: pullRequest({ comments: { nodes: comments } }),
				}),
			);
			expect(payload.conversation_truncated).toBe(true);
		});

		test("is true when review threads reach their cap", () => {
			const threads = Array.from({ length: MAX_REVIEW_THREADS }, (_, i) => ({
				isResolved: false,
				path: `a${i}.ts`,
				line: i,
				comments: { nodes: [] },
			}));
			const { payload } = normalisePR(
				detail({
					pullRequest: pullRequest({ reviewThreads: { nodes: threads } }),
				}),
			);
			expect(payload.conversation_truncated).toBe(true);
		});

		test("is true when labels reach their cap", () => {
			const labels = Array.from({ length: MAX_LABELS }, (_, i) => ({
				name: `label-${i}`,
			}));
			const { payload } = normalisePR(
				detail({ pullRequest: pullRequest({ labels: { nodes: labels } }) }),
			);
			expect(payload.conversation_truncated).toBe(true);
		});
	});
});
