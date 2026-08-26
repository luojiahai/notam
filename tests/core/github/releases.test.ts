import { describe, expect, test } from "bun:test";
import { GitHubError } from "../../../src/core/github/client.ts";
import {
	ReleaseClient,
	releaseSourceFromEnv,
} from "../../../src/core/github/releases.ts";

const SOURCE = {
	repo: "acme/notam",
	apiBase: "https://api.github.com",
	downloadBase: "https://github.com",
};

type Call = { url: string; headers: Record<string, string> };

/** Records every request and replays `responses` in order, one per call. */
function fakeFetch(responses: (Response | Error)[]) {
	const calls: Call[] = [];
	const fetchImpl = (async (
		url: string | URL | Request,
		init?: RequestInit,
	) => {
		const headers: Record<string, string> = {};
		new Headers(init?.headers).forEach((value, key) => {
			headers[key] = value;
		});
		calls.push({
			url: typeof url === "string" ? url : url.toString(),
			headers,
		});
		const next = responses.shift();
		if (next === undefined) throw new Error("unexpected extra request");
		if (next instanceof Error) throw next;
		return next;
	}) as typeof fetch;
	return { calls, fetchImpl };
}

function client(responses: (Response | Error)[]) {
	const { calls, fetchImpl } = fakeFetch(responses);
	return {
		calls,
		client: new ReleaseClient({
			...SOURCE,
			fetch: fetchImpl,
			sleep: async () => {},
		}),
	};
}

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}

describe("latestTag", () => {
	test("reads tag_name from the releases API", async () => {
		const { client: c, calls } = client([json({ tag_name: "v0.2.0" })]);
		expect(await c.latestTag()).toBe("v0.2.0");
		expect(calls[0]?.url).toBe(
			"https://api.github.com/repos/acme/notam/releases/latest",
		);
	});

	test("never sends an authorization header", async () => {
		const { client: c, calls } = client([json({ tag_name: "v0.2.0" })]);
		await c.latestTag();
		expect(Object.keys(calls[0]?.headers ?? {})).not.toContain("authorization");
	});

	test("fails when the release carries no tag", async () => {
		const { client: c } = client([json({})]);
		await expect(c.latestTag()).rejects.toThrow(GitHubError);
	});

	test("retries a 5xx and succeeds", async () => {
		const { client: c, calls } = client([
			json({ message: "bad gateway" }, 502),
			json({ tag_name: "v0.2.0" }),
		]);
		expect(await c.latestTag()).toBe("v0.2.0");
		expect(calls).toHaveLength(2);
	});

	test("gives up after the retry budget", async () => {
		const { client: c, calls } = client([
			json({}, 500),
			json({}, 500),
			json({}, 500),
			json({}, 500),
		]);
		await expect(c.latestTag()).rejects.toThrow(GitHubError);
		// One attempt plus the three retries, and then it stops.
		expect(calls).toHaveLength(4);
	});

	test("retries a network error", async () => {
		const { client: c, calls } = client([
			new Error("ECONNRESET"),
			json({ tag_name: "v0.2.0" }),
		]);
		expect(await c.latestTag()).toBe("v0.2.0");
		expect(calls).toHaveLength(2);
	});

	test("reports a 404 with its status", async () => {
		const { client: c } = client([json({ message: "Not Found" }, 404)]);
		await expect(c.latestTag()).rejects.toMatchObject({ status: 404 });
	});
});

describe("release assets", () => {
	test("downloads an asset from the tag's download URL", async () => {
		const { client: c, calls } = client([
			new Response(new Uint8Array([1, 2, 3])),
		]);
		const bytes = await c.downloadAsset("v0.2.0", "notam-linux-x64");
		expect([...bytes]).toEqual([1, 2, 3]);
		expect(calls[0]?.url).toBe(
			"https://github.com/acme/notam/releases/download/v0.2.0/notam-linux-x64",
		);
	});

	test("downloads the checksum manifest as text", async () => {
		const { client: c, calls } = client([
			new Response("abc  notam-linux-x64\n"),
		]);
		expect(await c.downloadChecksums("v0.2.0")).toBe("abc  notam-linux-x64\n");
		expect(calls[0]?.url).toBe(
			"https://github.com/acme/notam/releases/download/v0.2.0/SHA256SUMS",
		);
	});

	test("fails on a tag that has no such asset", async () => {
		const { client: c } = client([new Response("", { status: 404 })]);
		await expect(c.downloadAsset("v9.9.9", "notam-linux-x64")).rejects.toThrow(
			GitHubError,
		);
	});
});

describe("releaseSourceFromEnv", () => {
	test("defaults to the public repository", () => {
		expect(releaseSourceFromEnv({})).toEqual({
			repo: "luojiahai/notam",
			apiBase: "https://api.github.com",
			downloadBase: "https://github.com",
		});
	});

	test("honours the same overrides install.sh reads", () => {
		expect(
			releaseSourceFromEnv({
				NOTAM_REPO: "fork/notam",
				NOTAM_API_BASE: "http://127.0.0.1:9/api",
				NOTAM_DOWNLOAD_BASE: "http://127.0.0.1:9/dl",
			}),
		).toEqual({
			repo: "fork/notam",
			apiBase: "http://127.0.0.1:9/api",
			downloadBase: "http://127.0.0.1:9/dl",
		});
	});
});
