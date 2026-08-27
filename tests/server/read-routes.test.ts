import { describe, expect, test } from "bun:test";
import { isLoopbackHost } from "../../src/server/app.ts";
import {
	EntriesResponseSchema,
	EntryDetailSchema,
	MetaSchema,
	RepoSummarySchema,
} from "../../src/shared/api.ts";
import { setAnalysisState } from "../../src/store/entries.ts";
import { testContext } from "./helpers.ts";

describe("read routes", () => {
	test("GET /api/meta reports version, paths, and the analysis settings", async () => {
		const harness = testContext({ claudeAvailable: false });
		const response = await harness.app.request("/api/meta");
		expect(response.status).toBe(200);
		const meta = MetaSchema.parse(await response.json());
		expect(meta.version).toBe("test");
		expect(meta.claude_available).toBe(false);
		expect(meta.warnings.join(" ")).toContain("claude");
		expect(meta.analysis).toEqual({
			concurrency: 2,
			timeout_seconds: 30,
			model: null,
		});
		harness.close();
	});

	test("GET /api/repos lists every repository with its counts", async () => {
		const harness = testContext();
		const response = await harness.app.request("/api/repos");
		const repos = (await response.json()) as unknown[];
		expect(repos).toHaveLength(1);
		const repo = RepoSummarySchema.parse(repos[0]);
		expect(repo.name).toBe("acme/mono");
		expect(repo.entries.unanalysed).toBe(1);
		expect(repo.rules.total).toBe(0);
		harness.close();
	});

	test("GET entries filters by state while keeping the unfiltered counts", async () => {
		const harness = testContext();
		setAnalysisState(harness.db, harness.entryId, "failed", {
			error: "claude exited with code 1",
		});
		const all = EntriesResponseSchema.parse(
			await (
				await harness.app.request(`/api/repos/${harness.repoId}/entries`)
			).json(),
		);
		expect(all.entries).toHaveLength(1);
		expect(all.counts.failed).toBe(1);

		const unanalysed = EntriesResponseSchema.parse(
			await (
				await harness.app.request(
					`/api/repos/${harness.repoId}/entries?state=unanalysed`,
				)
			).json(),
		);
		expect(unanalysed.entries).toHaveLength(0);
		// The chips must still be able to say "Failed 1" while a filter is on.
		expect(unanalysed.counts.failed).toBe(1);
		harness.close();
	});

	test("GET entries applies the substring search", async () => {
		const harness = testContext();
		const hit = EntriesResponseSchema.parse(
			await (
				await harness.app.request(
					`/api/repos/${harness.repoId}/entries?q=rounding`,
				)
			).json(),
		);
		expect(hit.entries).toHaveLength(1);
		const miss = EntriesResponseSchema.parse(
			await (
				await harness.app.request(
					`/api/repos/${harness.repoId}/entries?q=kubernetes`,
				)
			).json(),
		);
		expect(miss.entries).toHaveLength(0);
		harness.close();
	});

	test("GET entries rejects an unknown state with 400", async () => {
		const harness = testContext();
		const response = await harness.app.request(
			`/api/repos/${harness.repoId}/entries?state=sideways`,
		);
		expect(response.status).toBe(400);
		harness.close();
	});

	test("GET /api/entries/:id returns the conversation for the panel", async () => {
		const harness = testContext();
		const response = await harness.app.request(
			`/api/entries/${harness.entryId}`,
		);
		const detail = EntryDetailSchema.parse(await response.json());
		expect(detail.number).toBe(4821);
		expect(detail.review_threads[0]?.comments[0]?.author).toBe("sam");
		expect(detail.changed_paths).toEqual(["services/payments/round.ts"]);
		expect(detail.rules).toEqual([]);
		harness.close();
	});

	test("an unknown id is a 404 with a JSON error body", async () => {
		const harness = testContext();
		const response = await harness.app.request("/api/entries/e_nope");
		expect(response.status).toBe(404);
		expect(await response.json()).toEqual({
			error: { message: "No entry with id e_nope" },
		});
		harness.close();
	});

	test("an unknown API path is a 404 with a JSON error body", async () => {
		const harness = testContext();
		const response = await harness.app.request("/api/nonsense");
		expect(response.status).toBe(404);
		expect(response.headers.get("content-type")).toContain("application/json");
		harness.close();
	});
});

/**
 * Binding 127.0.0.1 keeps the network off this port; it does not keep a
 * browser off it. A page whose DNS re-resolves to 127.0.0.1 would be
 * same-origin to the browser and there is no authentication behind these
 * routes, so a foreign Host header is refused outright.
 */
describe("host guard", () => {
	test("a foreign Host is refused before any route runs", async () => {
		const harness = testContext();
		const response = await harness.app.request("/api/repos", {
			headers: { host: "evil.com" },
		});
		expect(response.status).toBe(403);
		const body = (await response.json()) as { error: { message: string } };
		expect(body.error.message).toContain("evil.com");
		harness.close();
	});

	test("the guard covers the SPA and the event stream too, not just /api", async () => {
		const harness = testContext();
		for (const path of ["/", "/api/events"]) {
			const response = await harness.app.request(path, {
				headers: { host: "attacker.example" },
			});
			expect(response.status).toBe(403);
		}
		harness.close();
	});

	test("loopback hosts, with or without a port, are allowed", async () => {
		const harness = testContext();
		for (const host of ["127.0.0.1:4317", "localhost:4317", "localhost"]) {
			const response = await harness.app.request("/api/repos", {
				headers: { host },
			});
			expect(response.status).toBe(200);
		}
		harness.close();
	});

	test("isLoopbackHost accepts only the loopback names", () => {
		expect(isLoopbackHost("127.0.0.1:8787")).toBe(true);
		expect(isLoopbackHost("LocalHost:8787")).toBe(true);
		expect(isLoopbackHost("[::1]:8787")).toBe(true);
		expect(isLoopbackHost("evil.com")).toBe(false);
		// The one that matters: a name that merely contains a loopback name.
		expect(isLoopbackHost("127.0.0.1.evil.com")).toBe(false);
		expect(isLoopbackHost("localhost.evil.com:8787")).toBe(false);
		expect(isLoopbackHost(undefined)).toBe(false);
		expect(isLoopbackHost("")).toBe(false);
	});
});
