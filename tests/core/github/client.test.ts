import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
	type GitHubClientOptions,
	GitHubError,
	GraphQLGitHubClient,
} from "../../../src/core/github/client.ts";

const FIXTURES = join(import.meta.dir, "../../fixtures");

async function fixture(name: string): Promise<unknown> {
	return await Bun.file(join(FIXTURES, name)).json();
}

type Call = {
	url: string;
	headers: Record<string, string>;
	body: { query: string; variables: Record<string, unknown> };
};

/** A fake fetch that replays queued responses and records what was sent. */
function stubFetch(responses: Response[]) {
	const calls: Call[] = [];
	const remaining = [...responses];
	const impl = async (
		url: string | URL | Request,
		init?: RequestInit,
	): Promise<Response> => {
		calls.push({
			url: String(url),
			headers: (init?.headers ?? {}) as Record<string, string>,
			body: JSON.parse(String(init?.body)) as Call["body"],
		});
		const next = remaining.shift();
		if (!next) throw new Error("stub fetch ran out of responses");
		return next;
	};
	return { impl: impl as unknown as typeof fetch, calls };
}

/** A fake fetch that rejects (as a DNS failure or connection reset would) the first `failures` times, then returns `finalResponse`. */
function stubFetchWithFailures(failures: number, finalResponse: Response) {
	const calls: Call[] = [];
	let attempt = 0;
	const impl = async (
		url: string | URL | Request,
		init?: RequestInit,
	): Promise<Response> => {
		calls.push({
			url: String(url),
			headers: (init?.headers ?? {}) as Record<string, string>,
			body: JSON.parse(String(init?.body)) as Call["body"],
		});
		attempt++;
		if (attempt <= failures) throw new TypeError("fetch failed");
		return finalResponse;
	};
	return { impl: impl as unknown as typeof fetch, calls };
}

function json(body: unknown, init: ResponseInit = {}): Response {
	return new Response(JSON.stringify(body), {
		status: 200,
		headers: { "content-type": "application/json" },
		...init,
	});
}

function client(
	fetchImpl: typeof fetch,
	overrides: Partial<GitHubClientOptions> = {},
) {
	const sleeps: number[] = [];
	const instance = new GraphQLGitHubClient({
		endpoint: "https://api.github.com/graphql",
		token: "ghp_secret",
		fetch: fetchImpl,
		sleep: async (ms: number) => {
			sleeps.push(ms);
		},
		now: () => new Date("2026-08-23T09:00:00.000Z"),
		...overrides,
	});
	return { instance, sleeps };
}

const REPO = { owner: "acme", name: "mono" };

/** A files-only response, as PULL_REQUEST_FILES returns. */
function filesPage(
	paths: string[],
	hasNextPage: boolean,
	endCursor: string | null,
) {
	return {
		data: {
			repository: {
				pullRequest: {
					files: {
						pageInfo: { hasNextPage, endCursor },
						nodes: paths.map((path) => ({ path })),
					},
				},
			},
			rateLimit: { remaining: 4000, resetAt: "2026-08-23T10:00:00Z" },
		},
	};
}

/** The github.com detail fixture with its file connection swapped out. */
async function detailFixtureWithFiles(
	paths: string[],
	hasNextPage: boolean,
	endCursor: string | null,
) {
	const body = (await fixture("pr-detail-github.json")) as {
		data: { repository: { pullRequest: Record<string, unknown> } };
	};
	body.data.repository.pullRequest.files = {
		pageInfo: { hasNextPage, endCursor },
		nodes: paths.map((path) => ({ path })),
	};
	return body;
}

describe("listMergedPRs", () => {
	test("sends the listing query with the repository and page size", async () => {
		const stub = stubFetch([json(await fixture("pr-list-github.json"))]);
		const { instance } = client(stub.impl);
		await instance.listMergedPRs(REPO, { pageSize: 50 });
		expect(stub.calls[0]?.body.query).toContain("ListMergedPRs");
		expect(stub.calls[0]?.body.variables).toEqual({
			owner: "acme",
			name: "mono",
			pageSize: 50,
			cursor: null,
		});
	});

	test("authenticates with a bearer token and identifies itself", async () => {
		const stub = stubFetch([json(await fixture("pr-list-github.json"))]);
		const { instance } = client(stub.impl);
		await instance.listMergedPRs(REPO, {});
		expect(stub.calls[0]?.headers.authorization).toBe("Bearer ghp_secret");
		expect(stub.calls[0]?.headers["user-agent"]).toContain("notam");
	});

	test("maps the page, its cursor, and its has-next flag", async () => {
		const stub = stubFetch([json(await fixture("pr-list-github.json"))]);
		const { instance } = client(stub.impl);
		const page = await instance.listMergedPRs(REPO, {});
		expect(page.nodes.map((n) => n.number)).toEqual([4821, 4815]);
		expect(page.hasNextPage).toBe(true);
		expect(page.endCursor).toBe("Y3Vyc29yOjI=");
	});

	test("passes the cursor through on a later page", async () => {
		const stub = stubFetch([json(await fixture("pr-list-github.json"))]);
		const { instance } = client(stub.impl);
		await instance.listMergedPRs(REPO, { cursor: "Y3Vyc29yOjI=" });
		expect(stub.calls[0]?.body.variables.cursor).toBe("Y3Vyc29yOjI=");
	});

	test("posts to the configured endpoint, so GHES needs no separate code path", async () => {
		const stub = stubFetch([json(await fixture("pr-list-github.json"))]);
		const { instance } = client(stub.impl, {
			endpoint: "https://ghe.acme.net/api/graphql",
		});
		await instance.listMergedPRs(REPO, {});
		expect(stub.calls[0]?.url).toBe("https://ghe.acme.net/api/graphql");
	});
});

describe("fetchPRDetail", () => {
	test("returns the pull request node with its resolved file list", async () => {
		const stub = stubFetch([json(await fixture("pr-detail-github.json"))]);
		const { instance } = client(stub.impl);
		const detail = await instance.fetchPRDetail(REPO, 4821);
		expect(detail.pullRequest.number).toBe(4821);
		expect(detail.changedPaths).toEqual([
			"services/payments/round.ts",
			"services/payments/round.test.ts",
		]);
		expect(detail.pathsTruncated).toBe(false);
	});

	test("reads a GHES response with its nulls intact for the normaliser", async () => {
		const stub = stubFetch([json(await fixture("pr-detail-ghes.json"))]);
		const { instance } = client(stub.impl, {
			endpoint: "https://ghe.acme.net/api/graphql",
		});
		const detail = await instance.fetchPRDetail(
			{ owner: "acme", name: "internal" },
			118,
		);
		expect(detail.pullRequest.author).toBeNull();
		expect(detail.pullRequest.labels).toBeNull();
		expect(detail.changedPaths).toEqual(["libs/retry/loop.ts"]);
	});

	test("follows file pagination and merges the pages", async () => {
		const detailWithMoreFiles = await detailFixtureWithFiles(
			["services/payments/round.ts"],
			true,
			"c1",
		);
		const secondPage = filesPage(["libs/money/currency.ts"], false, null);
		const stub = stubFetch([json(detailWithMoreFiles), json(secondPage)]);
		const { instance } = client(stub.impl);
		const detail = await instance.fetchPRDetail(REPO, 4821);
		expect(stub.calls[1]?.body.query).toContain("PullRequestFiles");
		expect(stub.calls[1]?.body.variables.filesCursor).toBe("c1");
		expect(detail.changedPaths).toEqual([
			"services/payments/round.ts",
			"libs/money/currency.ts",
		]);
		expect(detail.pathsTruncated).toBe(false);
	});

	test("stops at the 300-file cap and flags truncation", async () => {
		const batch = (start: number) =>
			Array.from({ length: 100 }, (_, i) => `src/f${start + i}.ts`);
		const stub = stubFetch([
			json(await detailFixtureWithFiles(batch(0), true, "c1")),
			json(filesPage(batch(100), true, "c2")),
			json(filesPage(batch(200), true, "c3")),
		]);
		const { instance } = client(stub.impl);
		const detail = await instance.fetchPRDetail(REPO, 4821);
		expect(detail.changedPaths).toHaveLength(300);
		expect(detail.pathsTruncated).toBe(true);
		expect(stub.calls).toHaveLength(3);
	});

	test("reaches exactly 300 files with no further page and does not flag truncation", async () => {
		const batch = (start: number) =>
			Array.from({ length: 100 }, (_, i) => `src/f${start + i}.ts`);
		const stub = stubFetch([
			json(await detailFixtureWithFiles(batch(0), true, "c1")),
			json(filesPage(batch(100), true, "c2")),
			json(filesPage(batch(200), false, null)),
		]);
		const { instance } = client(stub.impl);
		const detail = await instance.fetchPRDetail(REPO, 4821);
		expect(detail.changedPaths).toHaveLength(300);
		expect(detail.pathsTruncated).toBe(false);
		expect(stub.calls).toHaveLength(3);
	});

	test("slices to 300 and flags truncation when a page pushes the total past the cap", async () => {
		const batch = (start: number, len: number) =>
			Array.from({ length: len }, (_, i) => `src/g${start + i}.ts`);
		const stub = stubFetch([
			json(await detailFixtureWithFiles(batch(0, 50), true, "c1")),
			json(filesPage(batch(50, 100), true, "c2")),
			json(filesPage(batch(150, 100), true, "c3")),
			json(filesPage(batch(250, 100), false, null)),
		]);
		const { instance } = client(stub.impl);
		const detail = await instance.fetchPRDetail(REPO, 4821);
		expect(detail.changedPaths).toHaveLength(300);
		expect(detail.pathsTruncated).toBe(true);
		expect(stub.calls).toHaveLength(4);
	});

	test("flags truncation when hasNextPage is true but the server gave no cursor to continue with", async () => {
		const stub = stubFetch([
			json(
				await detailFixtureWithFiles(
					["services/payments/round.ts"],
					true,
					null,
				),
			),
		]);
		const { instance } = client(stub.impl);
		const detail = await instance.fetchPRDetail(REPO, 4821);
		expect(detail.changedPaths).toEqual(["services/payments/round.ts"]);
		expect(detail.pathsTruncated).toBe(true);
		expect(stub.calls).toHaveLength(1);
	});

	test("terminates instead of hanging when the server keeps promising another page", async () => {
		const stuckPage = () => filesPage([], true, "c1");
		const stub = stubFetch([
			json(await detailFixtureWithFiles([], true, "c1")),
			json(stuckPage()),
			json(stuckPage()),
			json(stuckPage()),
			json(stuckPage()),
		]);
		const { instance } = client(stub.impl);
		const detail = await instance.fetchPRDetail(REPO, 4821);
		expect(detail.changedPaths).toEqual([]);
		expect(detail.pathsTruncated).toBe(true);
		expect(stub.calls).toHaveLength(5);
	});

	test("throws a clear error when the pull request does not exist", async () => {
		const stub = stubFetch([
			json({
				data: {
					repository: { pullRequest: null },
					rateLimit: { remaining: 10, resetAt: "2026-08-23T10:00:00Z" },
				},
			}),
		]);
		const { instance } = client(stub.impl);
		await expect(instance.fetchPRDetail(REPO, 9999)).rejects.toThrow(
			"acme/mono#9999",
		);
	});
});

describe("error handling", () => {
	test("surfaces GraphQL errors verbatim with a null status, since it is not an HTTP failure", async () => {
		const stub = stubFetch([
			json({ errors: [{ message: "Field 'reviewThreads' doesn't exist" }] }),
		]);
		const { instance } = client(stub.impl);
		let error: unknown;
		try {
			await instance.listMergedPRs(REPO, {});
		} catch (err) {
			error = err;
		}
		expect(error).toBeInstanceOf(GitHubError);
		expect((error as GitHubError).message).toContain(
			"Field 'reviewThreads' doesn't exist",
		);
		expect((error as GitHubError).status).toBeNull();
	});

	test("does not retry a 401, because a bad token will never come good", async () => {
		const stub = stubFetch([new Response("Bad credentials", { status: 401 })]);
		const { instance } = client(stub.impl);
		let error: unknown;
		try {
			await instance.listMergedPRs(REPO, {});
		} catch (err) {
			error = err;
		}
		expect(error).toBeInstanceOf(GitHubError);
		expect((error as GitHubError).status).toBe(401);
		expect(stub.calls).toHaveLength(1);
	});

	test("wraps a network failure like a transient 5xx and retries it", async () => {
		const stub = stubFetchWithFailures(
			1,
			json(await fixture("pr-list-github.json")),
		);
		const { instance, sleeps } = client(stub.impl);
		const page = await instance.listMergedPRs(REPO, {});
		expect(page.nodes).toHaveLength(2);
		expect(sleeps).toHaveLength(1);
		expect(stub.calls).toHaveLength(2);
	});

	test("gives up on a persistent network failure with a null-status GitHubError", async () => {
		const stub = stubFetchWithFailures(
			99,
			json(await fixture("pr-list-github.json")),
		);
		const { instance } = client(stub.impl, { maxRetries: 1 });
		let error: unknown;
		try {
			await instance.listMergedPRs(REPO, {});
		} catch (err) {
			error = err;
		}
		expect(error).toBeInstanceOf(GitHubError);
		expect((error as GitHubError).status).toBeNull();
		expect(stub.calls).toHaveLength(2);
	});

	test("shares its retry budget between network failures and 5xx responses, not two separate policies", async () => {
		const calls: string[] = [];
		let attempt = 0;
		const impl = async (): Promise<Response> => {
			attempt++;
			calls.push(`attempt-${attempt}`);
			if (attempt === 1) throw new TypeError("fetch failed");
			if (attempt === 2) return new Response("bad gateway", { status: 502 });
			return json(await fixture("pr-list-github.json"));
		};
		const { instance, sleeps } = client(impl as unknown as typeof fetch, {
			maxRetries: 2,
		});
		const page = await instance.listMergedPRs(REPO, {});
		expect(page.nodes).toHaveLength(2);
		expect(calls).toHaveLength(3);
		expect(sleeps).toHaveLength(2);
	});

	test("retries a 502 and succeeds", async () => {
		const stub = stubFetch([
			new Response("bad gateway", { status: 502 }),
			json(await fixture("pr-list-github.json")),
		]);
		const { instance, sleeps } = client(stub.impl);
		const page = await instance.listMergedPRs(REPO, {});
		expect(page.nodes).toHaveLength(2);
		expect(sleeps).toHaveLength(1);
	});

	test("gives up on a persistent 500 after maxRetries", async () => {
		const stub = stubFetch([
			new Response("boom", { status: 500 }),
			new Response("boom", { status: 500 }),
			new Response("boom", { status: 500 }),
		]);
		const { instance } = client(stub.impl, { maxRetries: 2 });
		await expect(instance.listMergedPRs(REPO, {})).rejects.toThrow("500");
		expect(stub.calls).toHaveLength(3);
	});

	test("repeats the repository in the message so the failing repo is obvious", async () => {
		const stub = stubFetch([new Response("Not Found", { status: 404 })]);
		const { instance } = client(stub.impl);
		await expect(instance.listMergedPRs(REPO, {})).rejects.toThrow("acme/mono");
	});
});

describe("rate limiting", () => {
	test("pauses until the reset time on a 403 with an exhausted quota, then retries", async () => {
		const limited = new Response("rate limited", {
			status: 403,
			headers: {
				"x-ratelimit-remaining": "0",
				"x-ratelimit-reset": String(
					Math.floor(new Date("2026-08-23T09:00:30.000Z").getTime() / 1000),
				),
			},
		});
		const stub = stubFetch([
			limited,
			json(await fixture("pr-list-github.json")),
		]);
		const { instance, sleeps } = client(stub.impl);
		const page = await instance.listMergedPRs(REPO, {});
		expect(page.nodes).toHaveLength(2);
		expect(sleeps[0]).toBeGreaterThanOrEqual(30_000);
	});

	test("honours retry-after on a 429", async () => {
		const limited = new Response("slow down", {
			status: 429,
			headers: { "retry-after": "12" },
		});
		const stub = stubFetch([
			limited,
			json(await fixture("pr-list-github.json")),
		]);
		const { instance, sleeps } = client(stub.impl);
		await instance.listMergedPRs(REPO, {});
		expect(sleeps[0]).toBe(12_000);
	});

	test("pauses proactively when the remaining quota falls to the threshold", async () => {
		const nearlyOut = {
			data: {
				repository: {
					pullRequests: {
						pageInfo: { hasNextPage: false, endCursor: null },
						nodes: [],
					},
				},
				rateLimit: { remaining: 2, resetAt: "2026-08-23T09:01:00.000Z" },
			},
		};
		const stub = stubFetch([json(nearlyOut)]);
		const { instance, sleeps } = client(stub.impl, { rateLimitFloor: 5 });
		await instance.listMergedPRs(REPO, {});
		expect(sleeps[0]).toBeGreaterThanOrEqual(60_000);
	});

	test("reports each pause so the CLI and UI can say why nothing is happening", async () => {
		const limited = new Response("rate limited", {
			status: 429,
			headers: { "retry-after": "3" },
		});
		const stub = stubFetch([
			limited,
			json(await fixture("pr-list-github.json")),
		]);
		const pauses: { waitMs: number; reason: string }[] = [];
		const { instance } = client(stub.impl, {
			onRateLimitPause: (info) => pauses.push(info),
		});
		await instance.listMergedPRs(REPO, {});
		expect(pauses).toHaveLength(1);
		expect(pauses[0]?.waitMs).toBe(3_000);
	});

	test("a rate-limit pause is not a failure and does not consume a retry", async () => {
		const limited = () =>
			new Response("rate limited", {
				status: 429,
				headers: { "retry-after": "1" },
			});
		const stub = stubFetch([
			limited(),
			limited(),
			limited(),
			json(await fixture("pr-list-github.json")),
		]);
		const { instance } = client(stub.impl, { maxRetries: 1 });
		const page = await instance.listMergedPRs(REPO, {});
		expect(page.nodes).toHaveLength(2);
	});
});

describe("cancellation", () => {
	test("passes the caller's signal to fetch, so a request in flight is abortable", async () => {
		const stub = stubFetch([json(await fixture("pr-list-github.json"))]);
		const controller = new AbortController();
		const seen: (AbortSignal | null | undefined)[] = [];
		const spying = (async (url: string | URL | Request, init?: RequestInit) => {
			seen.push(init?.signal);
			return await stub.impl(url as string, init);
		}) as unknown as typeof fetch;
		const { instance } = client(spying);
		await instance.listMergedPRs(REPO, { signal: controller.signal });
		expect(seen).toEqual([controller.signal]);
	});

	test("abandons a rate-limit pause instead of sitting it out", async () => {
		const limited = new Response("slow down", {
			status: 429,
			headers: { "retry-after": "600" },
		});
		const stub = stubFetch([
			limited,
			json(await fixture("pr-list-github.json")),
		]);
		const controller = new AbortController();
		// A sleep that never settles: only the abort can end this pause, which
		// is what a ten-minute reset window looks like to a user pressing Stop.
		const { instance } = client(stub.impl, {
			sleep: () =>
				new Promise<void>(() => {
					controller.abort();
				}),
		});
		await expect(
			instance.listMergedPRs(REPO, { signal: controller.signal }),
		).rejects.toThrow();
		expect(stub.calls).toHaveLength(1);
	});

	test("never retries an aborted request, however much budget is left", async () => {
		const controller = new AbortController();
		let attempts = 0;
		const aborting = (async () => {
			attempts++;
			controller.abort();
			throw controller.signal.reason;
		}) as unknown as typeof fetch;
		const { instance, sleeps } = client(aborting, { maxRetries: 5 });
		await expect(
			instance.listMergedPRs(REPO, { signal: controller.signal }),
		).rejects.toThrow();
		expect(attempts).toBe(1);
		expect(sleeps).toEqual([]);
	});

	test("still retries an ordinary network failure when no signal is aborted", async () => {
		const stub = stubFetchWithFailures(
			1,
			json(await fixture("pr-list-github.json")),
		);
		const controller = new AbortController();
		const { instance, sleeps } = client(stub.impl);
		await instance.listMergedPRs(REPO, { signal: controller.signal });
		expect(sleeps).toHaveLength(1);
	});
});
