import { describe, expect, test } from "bun:test";
import { GitHubError } from "../../../src/core/github/client.ts";
import {
	type RestClientOptions,
	RestGitHubClient,
} from "../../../src/core/github/rest.ts";
import type { RepoRef } from "../../../src/core/github/types.ts";
import type { PromotionState } from "../../../src/shared/types.ts";

const REPO: RepoRef = { owner: "acme", name: "mono" };
const API = "https://api.github.com";

type Call = { method: string; path: string; body: unknown };

/**
 * A fake Git Data API. `routes` maps "METHOD /path" to a response; anything
 * unmatched is a 404, which is how the "no rules directory yet" case is driven.
 */
function fakeApi(routes: Record<string, unknown>) {
	const calls: Call[] = [];
	const fetchImpl = (async (
		url: string | URL | Request,
		init?: RequestInit,
	) => {
		const href = typeof url === "string" ? url : url.toString();
		const path = href.slice(API.length);
		const method = init?.method ?? "GET";
		const body = init?.body ? JSON.parse(String(init.body)) : undefined;
		calls.push({ method, path, body });

		const route = routes[`${method} ${path}`];
		if (route === undefined) {
			return new Response(JSON.stringify({ message: "Not Found" }), {
				status: 404,
				headers: { "content-type": "application/json" },
			});
		}
		if (route instanceof Response) return route.clone();
		return new Response(JSON.stringify(route), {
			status: 200,
			headers: { "content-type": "application/json" },
		});
	}) as unknown as typeof fetch;

	return { calls, fetchImpl };
}

function client(
	fetchImpl: typeof fetch,
	overrides: Partial<RestClientOptions> = {},
) {
	return new RestGitHubClient({
		apiBase: API,
		token: "t",
		fetch: fetchImpl,
		sleep: async () => {},
		...overrides,
	});
}

describe("listRuleFiles", () => {
	test("returns the .md base names in .claude/rules", async () => {
		const { fetchImpl, calls } = fakeApi({
			"GET /repos/acme/mono/contents/.claude/rules?ref=main": [
				{ type: "file", name: "always-add-a-test.md" },
				{ type: "file", name: "README.txt" },
				{ type: "dir", name: "nested" },
			],
		});
		expect(await client(fetchImpl).listRuleFiles(REPO, "main")).toEqual([
			"always-add-a-test.md",
		]);
		expect(calls[0]?.method).toBe("GET");
	});

	test("treats a missing directory as no files, not as an error", async () => {
		const { fetchImpl } = fakeApi({});
		expect(await client(fetchImpl).listRuleFiles(REPO, "main")).toEqual([]);
	});

	test("treats a file at that path as no files", async () => {
		const { fetchImpl } = fakeApi({
			"GET /repos/acme/mono/contents/.claude/rules?ref=main": {
				type: "file",
				name: "rules",
			},
		});
		expect(await client(fetchImpl).listRuleFiles(REPO, "main")).toEqual([]);
	});
});

describe("createPRWithFiles", () => {
	function happyPath() {
		return fakeApi({
			"GET /repos/acme/mono/git/ref/heads/main": {
				object: { sha: "base-commit" },
			},
			"GET /repos/acme/mono/git/commits/base-commit": {
				tree: { sha: "base-tree" },
			},
			"POST /repos/acme/mono/git/blobs": { sha: "blob-sha" },
			"POST /repos/acme/mono/git/trees": { sha: "new-tree" },
			"POST /repos/acme/mono/git/commits": { sha: "new-commit" },
			"POST /repos/acme/mono/git/refs": { ref: "refs/heads/notam/rules-x" },
			"POST /repos/acme/mono/pulls": {
				number: 99,
				html_url: "https://github.com/acme/mono/pull/99",
			},
		});
	}

	const request = {
		baseBranch: "main",
		branch: "notam/rules-x",
		message: "Add 2 NOTAM rules",
		title: "Add 2 NOTAM rules",
		body: "body text",
		files: [
			{ path: ".claude/rules/a.md", content: "A" },
			{ path: ".claude/rules/b.md", content: "B" },
		],
	};

	test("walks ref -> commit -> blobs -> tree -> commit -> ref -> PR in that exact order", async () => {
		const { fetchImpl, calls } = happyPath();
		const result = await client(fetchImpl).createPRWithFiles(REPO, request);

		expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
			"GET /repos/acme/mono/git/ref/heads/main",
			"GET /repos/acme/mono/git/commits/base-commit",
			"POST /repos/acme/mono/git/blobs",
			"POST /repos/acme/mono/git/blobs",
			"POST /repos/acme/mono/git/trees",
			"POST /repos/acme/mono/git/commits",
			"POST /repos/acme/mono/git/refs",
			"POST /repos/acme/mono/pulls",
		]);
		expect(result).toEqual({
			number: 99,
			url: "https://github.com/acme/mono/pull/99",
			branch: "notam/rules-x",
			commitSha: "new-commit",
		});
	});

	test("sends the right payload at every step", async () => {
		const { fetchImpl, calls } = happyPath();
		await client(fetchImpl).createPRWithFiles(REPO, request);

		expect(calls[2]?.body).toEqual({ content: "A", encoding: "utf-8" });
		expect(calls[3]?.body).toEqual({ content: "B", encoding: "utf-8" });
		expect(calls[4]?.body).toEqual({
			base_tree: "base-tree",
			tree: [
				{
					path: ".claude/rules/a.md",
					mode: "100644",
					type: "blob",
					sha: "blob-sha",
				},
				{
					path: ".claude/rules/b.md",
					mode: "100644",
					type: "blob",
					sha: "blob-sha",
				},
			],
		});
		expect(calls[5]?.body).toEqual({
			message: "Add 2 NOTAM rules",
			tree: "new-tree",
			parents: ["base-commit"],
		});
		expect(calls[6]?.body).toEqual({
			ref: "refs/heads/notam/rules-x",
			sha: "new-commit",
		});
		expect(calls[7]?.body).toEqual({
			title: "Add 2 NOTAM rules",
			head: "notam/rules-x",
			base: "main",
			body: "body text",
		});
	});

	test("surfaces GitHub's error text verbatim and stops at the failing step", async () => {
		const { fetchImpl, calls } = fakeApi({
			"GET /repos/acme/mono/git/ref/heads/main": {
				object: { sha: "base-commit" },
			},
			"GET /repos/acme/mono/git/commits/base-commit": {
				tree: { sha: "base-tree" },
			},
			"POST /repos/acme/mono/git/blobs": { sha: "blob-sha" },
			"POST /repos/acme/mono/git/trees": { sha: "new-tree" },
			"POST /repos/acme/mono/git/commits": { sha: "new-commit" },
			"POST /repos/acme/mono/git/refs": new Response(
				JSON.stringify({ message: "Reference already exists" }),
				{ status: 422 },
			),
		});

		await expect(
			client(fetchImpl).createPRWithFiles(REPO, request),
		).rejects.toThrow(/Reference already exists/);
		// The pull request call must never have been attempted.
		expect(calls.some((c) => c.path.endsWith("/pulls"))).toBe(false);
	});

	test("a 403 with no write access is reported, not retried forever", async () => {
		const { fetchImpl } = fakeApi({
			"GET /repos/acme/mono/git/ref/heads/main": new Response(
				JSON.stringify({ message: "Resource not accessible by integration" }),
				{ status: 403 },
			),
		});
		await expect(
			client(fetchImpl).createPRWithFiles(REPO, request),
		).rejects.toThrow(/Resource not accessible/);
	});

	test("retries a 500 and then succeeds", async () => {
		let refCalls = 0;
		const fetchImpl = (async (url: string | URL) => {
			const path = String(url).slice(API.length);
			if (path === "/repos/acme/mono/git/ref/heads/main") {
				refCalls++;
				if (refCalls === 1)
					return new Response("upstream boom", { status: 500 });
				return new Response(JSON.stringify({ object: { sha: "base-commit" } }));
			}
			if (path === "/repos/acme/mono/git/commits/base-commit")
				return new Response(JSON.stringify({ tree: { sha: "base-tree" } }));
			if (path === "/repos/acme/mono/git/blobs")
				return new Response(JSON.stringify({ sha: "blob-sha" }));
			if (path === "/repos/acme/mono/git/trees")
				return new Response(JSON.stringify({ sha: "new-tree" }));
			if (path === "/repos/acme/mono/git/commits")
				return new Response(JSON.stringify({ sha: "new-commit" }));
			if (path === "/repos/acme/mono/git/refs")
				return new Response(JSON.stringify({}));
			return new Response(JSON.stringify({ number: 1, html_url: "u" }));
		}) as unknown as typeof fetch;

		const result = await client(fetchImpl).createPRWithFiles(REPO, request);
		expect(refCalls).toBe(2);
		expect(result.number).toBe(1);
	});

	test("gives up after the retry budget and throws a GitHubError", async () => {
		const fetchImpl = (async () =>
			new Response("still broken", { status: 502 })) as unknown as typeof fetch;
		await expect(
			client(fetchImpl, { maxRetries: 1 }).createPRWithFiles(REPO, request),
		).rejects.toThrow(GitHubError);
	});

	test("does not retry the non-idempotent POST /git/refs on a 500 — issues it exactly once", async () => {
		let refsCalls = 0;
		const fetchImpl = (async (url: string | URL) => {
			const path = String(url).slice(API.length);
			if (path === "/repos/acme/mono/git/ref/heads/main")
				return new Response(JSON.stringify({ object: { sha: "base-commit" } }));
			if (path === "/repos/acme/mono/git/commits/base-commit")
				return new Response(JSON.stringify({ tree: { sha: "base-tree" } }));
			if (path === "/repos/acme/mono/git/blobs")
				return new Response(JSON.stringify({ sha: "blob-sha" }));
			if (path === "/repos/acme/mono/git/trees")
				return new Response(JSON.stringify({ sha: "new-tree" }));
			if (path === "/repos/acme/mono/git/commits")
				return new Response(JSON.stringify({ sha: "new-commit" }));
			if (path === "/repos/acme/mono/git/refs") {
				refsCalls++;
				return new Response("upstream boom", { status: 500 });
			}
			throw new Error("the pull request endpoint must never be reached");
		}) as unknown as typeof fetch;

		await expect(
			client(fetchImpl).createPRWithFiles(REPO, request),
		).rejects.toThrow(/upstream boom/);
		expect(refsCalls).toBe(1);
	});

	test("does not retry the non-idempotent POST /pulls on a 500 — issues it exactly once", async () => {
		let pullsCalls = 0;
		const fetchImpl = (async (url: string | URL) => {
			const path = String(url).slice(API.length);
			if (path === "/repos/acme/mono/git/ref/heads/main")
				return new Response(JSON.stringify({ object: { sha: "base-commit" } }));
			if (path === "/repos/acme/mono/git/commits/base-commit")
				return new Response(JSON.stringify({ tree: { sha: "base-tree" } }));
			if (path === "/repos/acme/mono/git/blobs")
				return new Response(JSON.stringify({ sha: "blob-sha" }));
			if (path === "/repos/acme/mono/git/trees")
				return new Response(JSON.stringify({ sha: "new-tree" }));
			if (path === "/repos/acme/mono/git/commits")
				return new Response(JSON.stringify({ sha: "new-commit" }));
			if (path === "/repos/acme/mono/git/refs")
				return new Response(JSON.stringify({}));
			if (path === "/repos/acme/mono/pulls") {
				pullsCalls++;
				return new Response("upstream boom", { status: 500 });
			}
			throw new Error(`unexpected path ${path}`);
		}) as unknown as typeof fetch;

		await expect(
			client(fetchImpl).createPRWithFiles(REPO, request),
		).rejects.toThrow(/upstream boom/);
		expect(pullsCalls).toBe(1);
	});

	test("does not retry the non-idempotent POST /pulls on a network error — issues it exactly once", async () => {
		let pullsCalls = 0;
		const fetchImpl = (async (url: string | URL) => {
			const path = String(url).slice(API.length);
			if (path === "/repos/acme/mono/git/ref/heads/main")
				return new Response(JSON.stringify({ object: { sha: "base-commit" } }));
			if (path === "/repos/acme/mono/git/commits/base-commit")
				return new Response(JSON.stringify({ tree: { sha: "base-tree" } }));
			if (path === "/repos/acme/mono/git/blobs")
				return new Response(JSON.stringify({ sha: "blob-sha" }));
			if (path === "/repos/acme/mono/git/trees")
				return new Response(JSON.stringify({ sha: "new-tree" }));
			if (path === "/repos/acme/mono/git/commits")
				return new Response(JSON.stringify({ sha: "new-commit" }));
			if (path === "/repos/acme/mono/git/refs")
				return new Response(JSON.stringify({}));
			if (path === "/repos/acme/mono/pulls") {
				pullsCalls++;
				throw new TypeError("socket reset");
			}
			throw new Error(`unexpected path ${path}`);
		}) as unknown as typeof fetch;

		await expect(
			client(fetchImpl).createPRWithFiles(REPO, request),
		).rejects.toThrow(/socket reset/);
		expect(pullsCalls).toBe(1);
	});

	test("still retries the idempotent GET ref read on a 500 (control case)", async () => {
		const { fetchImpl, calls } = happyPath();
		let getCalls = 0;
		const withFlakyGet = (async (url: string | URL, init?: RequestInit) => {
			const path = String(url).slice(API.length);
			if (path === "/repos/acme/mono/git/ref/heads/main") {
				getCalls++;
				if (getCalls === 1)
					return new Response("upstream boom", { status: 500 });
			}
			return fetchImpl(url, init);
		}) as unknown as typeof fetch;

		const result = await client(withFlakyGet).createPRWithFiles(REPO, request);
		expect(getCalls).toBe(2);
		expect(result.number).toBe(99);
		expect(calls.length).toBeGreaterThan(0);
	});
});

describe("getPRState", () => {
	test("reports merged, closed, and open", async () => {
		const cases: [Record<string, unknown>, PromotionState][] = [
			[{ state: "closed", merged: true }, "merged"],
			[{ state: "closed", merged: false }, "closed"],
			[{ state: "open", merged: false }, "open"],
		];
		for (const [response, expected] of cases) {
			const { fetchImpl } = fakeApi({
				"GET /repos/acme/mono/pulls/7": response,
			});
			expect(await client(fetchImpl).getPRState(REPO, 7)).toBe(expected);
		}
	});

	test("throws for a pull request that is not there", async () => {
		const { fetchImpl } = fakeApi({});
		await expect(client(fetchImpl).getPRState(REPO, 7)).rejects.toThrow(
			GitHubError,
		);
	});
});

describe("GHES", () => {
	test("prefixes every path with the enterprise API base", async () => {
		const calls: string[] = [];
		const fetchImpl = (async (url: string | URL) => {
			calls.push(String(url));
			return new Response(JSON.stringify({ state: "open", merged: false }));
		}) as unknown as typeof fetch;

		await new RestGitHubClient({
			apiBase: "https://ghe.acme.net/api/v3",
			token: "t",
			fetch: fetchImpl,
		}).getPRState(REPO, 7);

		expect(calls[0]).toBe(
			"https://ghe.acme.net/api/v3/repos/acme/mono/pulls/7",
		);
	});
});
