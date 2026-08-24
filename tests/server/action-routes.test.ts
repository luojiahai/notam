import { describe, expect, test } from "bun:test";
import {
	CancelResultSchema,
	QueueResultSchema,
	RepoAnalyseCancelledSchema,
	type ServerEvent,
	SyncCancelledSchema,
	SyncStartedSchema,
} from "../../src/shared/api.ts";
import { getEntry } from "../../src/store/entries.ts";
import { listRulesByEntry } from "../../src/store/rules.ts";
import { testContext } from "./helpers.ts";

function post(
	app: {
		request: (
			input: string,
			init?: RequestInit,
		) => Response | Promise<Response>;
	},
	path: string,
	body?: unknown,
) {
	return app.request(path, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: body === undefined ? undefined : JSON.stringify(body),
	});
}

describe("action routes", () => {
	test("POST sync enqueues a job and reports it", async () => {
		const harness = testContext();
		const events: ServerEvent[] = [];
		harness.ctx.bus.subscribe((event) => events.push(event));

		const response = await post(
			harness.app,
			`/api/repos/${harness.repoId}/sync`,
		);
		const started = SyncStartedSchema.parse(await response.json());
		expect(started.job_id).not.toBeNull();
		expect(started.already_running).toBe(false);

		await harness.ctx.syncRunner.idle();
		const phases = events
			.filter((event) => event.type === "sync")
			.map((event) => (event.type === "sync" ? event.phase : ""));
		expect(phases).toEqual(["started", "finished"]);
		harness.close();
	});

	test("POST sync twice reports the second as already running", async () => {
		const harness = testContext();
		harness.ctx.queue.enqueue("sync", harness.repoId);
		const response = await post(
			harness.app,
			`/api/repos/${harness.repoId}/sync`,
		);
		const started = SyncStartedSchema.parse(await response.json());
		expect(started.job_id).toBeNull();
		expect(started.already_running).toBe(true);
		await harness.ctx.syncRunner.idle();
		harness.close();
	});

	test("POST analyse queues the selection, drains it, and inserts drafts", async () => {
		const harness = testContext();
		const events: ServerEvent[] = [];
		harness.ctx.bus.subscribe((event) => events.push(event));

		const response = await post(harness.app, "/api/entries/analyse", {
			entry_ids: [harness.entryId],
		});
		expect(QueueResultSchema.parse(await response.json())).toEqual({
			queued: [harness.entryId],
			skipped: [],
		});

		await harness.ctx.analyseRunner.idle();
		expect(getEntry(harness.db, harness.entryId)?.analysis_state).toBe(
			"analysed",
		);
		const rules = listRulesByEntry(harness.db, harness.entryId);
		expect(rules).toHaveLength(1);
		expect(rules[0]?.status).toBe("draft");

		const entryStates = events
			.filter((event) => event.type === "entry")
			.map((event) => (event.type === "entry" ? event.state : ""));
		expect(entryStates).toEqual(["running", "analysed"]);
		expect(events.some((event) => event.type === "rules")).toBe(true);
		harness.close();
	});

	test("the analyser's instruction goes in argv and the payload on stdin", async () => {
		const harness = testContext();
		await post(harness.app, "/api/entries/analyse", {
			entry_ids: [harness.entryId],
		});
		await harness.ctx.analyseRunner.idle();
		expect(harness.runnerCalls).toHaveLength(1);
		expect(harness.runnerCalls[0]?.stdin).toContain("Fix rounding in payments");
		expect(harness.runnerCalls[0]?.instruction).not.toContain(
			"Fix rounding in payments",
		);
		// Config's analysis.timeout_seconds reaches the runner.
		expect(harness.runnerCalls[0]?.timeoutMs).toBe(30_000);
		harness.close();
	});

	test("a failing analyser leaves the entry failed with its error stored", async () => {
		const harness = testContext({
			claude: () => ({
				ok: false,
				kind: "missing",
				message: "The claude CLI was not found on PATH.",
			}),
		});
		await post(harness.app, "/api/entries/analyse", {
			entry_ids: [harness.entryId],
		});
		await harness.ctx.analyseRunner.idle();
		const entry = getEntry(harness.db, harness.entryId);
		expect(entry?.analysis_state).toBe("failed");
		expect(entry?.last_error).toContain("claude CLI was not found");
		harness.close();
	});

	test("POST analyse rejects an unknown entry with 404 and queues nothing", async () => {
		const harness = testContext();
		const response = await post(harness.app, "/api/entries/analyse", {
			entry_ids: [harness.entryId, "e_nope"],
		});
		expect(response.status).toBe(404);
		expect(harness.ctx.queue.count("queued")).toBe(0);
		harness.close();
	});

	test("POST analyse rejects an empty selection with 400", async () => {
		const harness = testContext();
		const response = await post(harness.app, "/api/entries/analyse", {
			entry_ids: [],
		});
		expect(response.status).toBe(400);
		harness.close();
	});

	test("a body that is not JSON is a 400, not a 500", async () => {
		const harness = testContext();
		const response = await harness.app.request("/api/entries/analyse", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: "{not json",
		});
		expect(response.status).toBe(400);
		harness.close();
	});
});

describe("sync cancellation", () => {
	/** Seeds one merged PR the fake will hydrate, matching the config's globs. */
	function seedPR(harness: ReturnType<typeof testContext>) {
		harness.github.prs = [
			{
				pullRequest: {
					number: 5150,
					title: "Retry the payments webhook",
					body: "body",
					url: "https://github.com/acme/mono/pull/5150",
					updatedAt: "2026-08-20T00:00:00Z",
					mergedAt: "2026-08-20T00:00:00Z",
					author: { login: "dana" },
					labels: { nodes: [] },
					reviews: { nodes: [] },
					reviewThreads: { nodes: [] },
					comments: { nodes: [] },
				},
				changedPaths: ["services/payments/webhook.ts"],
				pathsTruncated: false,
			},
		];
	}

	test("stops a sync that is already running and says so on the wire", async () => {
		const harness = testContext();
		seedPR(harness);
		let release!: () => void;
		harness.github.hold = new Promise<void>((resolve) => {
			release = resolve;
		});
		const events: ServerEvent[] = [];
		harness.ctx.bus.subscribe((event) => events.push(event));

		await post(harness.app, `/api/repos/${harness.repoId}/sync`);
		await harness.github.entered;

		const response = await post(
			harness.app,
			`/api/repos/${harness.repoId}/sync/cancel`,
		);
		expect(SyncCancelledSchema.parse(await response.json())).toEqual({
			cancelled: true,
		});

		release();
		await harness.ctx.syncRunner.idle();
		const phases = events
			.filter((event) => event.type === "sync")
			.map((event) => (event.type === "sync" ? event.phase : ""));
		expect(phases).toEqual(["started", "cancelled"]);
		expect(harness.ctx.queue.status("sync", harness.repoId).last?.state).toBe(
			"cancelled",
		);
		harness.close();
	});

	test("stops a sync still queued, without ever claiming it", async () => {
		const harness = testContext();
		const job = harness.ctx.queue.enqueue("sync", harness.repoId);
		if (!job) throw new Error("expected a job");

		const response = await post(
			harness.app,
			`/api/repos/${harness.repoId}/sync/cancel`,
		);
		expect(SyncCancelledSchema.parse(await response.json()).cancelled).toBe(
			true,
		);
		expect(harness.ctx.queue.get(job.id)?.state).toBe("cancelled");
		harness.close();
	});

	test("cancelling nothing is a no-op, not an error", async () => {
		const harness = testContext();
		const response = await post(
			harness.app,
			`/api/repos/${harness.repoId}/sync/cancel`,
		);
		expect(response.status).toBe(200);
		expect(SyncCancelledSchema.parse(await response.json()).cancelled).toBe(
			false,
		);
		harness.close();
	});

	test("404s for a repository that does not exist", async () => {
		const harness = testContext();
		const response = await post(harness.app, "/api/repos/r_nope/sync/cancel");
		expect(response.status).toBe(404);
		harness.close();
	});

	test("leaves the repository immediately re-syncable", async () => {
		const harness = testContext();
		const job = harness.ctx.queue.enqueue("sync", harness.repoId);
		if (!job) throw new Error("expected a job");
		await post(harness.app, `/api/repos/${harness.repoId}/sync/cancel`);

		const response = await post(
			harness.app,
			`/api/repos/${harness.repoId}/sync`,
		);
		const started = SyncStartedSchema.parse(await response.json());
		expect(started.already_running).toBe(false);
		expect(started.job_id).not.toBeNull();
		await harness.ctx.syncRunner.idle();
		harness.close();
	});
});

describe("analysis cancellation", () => {
	/**
	 * A harness whose analyser hangs until its run is stopped, then reports the
	 * kill the way the real runner does. `entered` resolves once the analysis is
	 * genuinely in flight, so a test never cancels something not yet started.
	 */
	function heldAnalyser() {
		let enter!: () => void;
		const entered = new Promise<void>((resolve) => {
			enter = resolve;
		});
		const harness = testContext({
			claude: (request) => {
				enter();
				return new Promise((resolve) => {
					request.signal?.addEventListener("abort", () =>
						resolve({
							ok: false,
							kind: "aborted",
							message: "claude was cancelled",
						}),
					);
				});
			},
		});
		return { harness, entered };
	}

	test("stops a running analysis and puts the entry back where it was", async () => {
		const { harness, entered } = heldAnalyser();
		const events: ServerEvent[] = [];
		harness.ctx.bus.subscribe((event) => events.push(event));

		await post(harness.app, "/api/entries/analyse", {
			entry_ids: [harness.entryId],
		});
		await entered;

		const response = await post(harness.app, "/api/entries/analyse/cancel", {
			entry_ids: [harness.entryId],
		});
		expect(CancelResultSchema.parse(await response.json())).toEqual({
			cancelled: [harness.entryId],
			skipped: [],
		});

		await harness.ctx.analyseRunner.idle();
		const entry = getEntry(harness.db, harness.entryId);
		expect(entry?.analysis_state).toBe("unanalysed");
		expect(entry?.last_error).toBeNull();
		expect(
			harness.ctx.queue.status("analyse", harness.entryId).last?.state,
		).toBe("cancelled");

		const states = events
			.filter((event) => event.type === "entry")
			.map((event) => (event.type === "entry" ? event.state : ""));
		expect(states).toEqual(["running", "unanalysed"]);
		harness.close();
	});

	test("stops an analysis still queued, without ever claiming it", async () => {
		const harness = testContext();
		const job = harness.ctx.queue.enqueue("analyse", harness.entryId);
		if (!job) throw new Error("expected a job");

		const response = await post(harness.app, "/api/entries/analyse/cancel", {
			entry_ids: [harness.entryId],
		});
		expect(CancelResultSchema.parse(await response.json()).cancelled).toEqual([
			harness.entryId,
		]);
		expect(harness.ctx.queue.get(job.id)?.state).toBe("cancelled");
		expect(harness.runnerCalls).toHaveLength(0);
		harness.close();
	});

	test("reports an entry with nothing pending as skipped, not as an error", async () => {
		const harness = testContext();
		const response = await post(harness.app, "/api/entries/analyse/cancel", {
			entry_ids: [harness.entryId],
		});
		expect(response.status).toBe(200);
		expect(CancelResultSchema.parse(await response.json())).toEqual({
			cancelled: [],
			skipped: [harness.entryId],
		});
		harness.close();
	});

	test("rejects an unknown entry with 404 and cancels nothing", async () => {
		const harness = testContext();
		const job = harness.ctx.queue.enqueue("analyse", harness.entryId);
		if (!job) throw new Error("expected a job");

		const response = await post(harness.app, "/api/entries/analyse/cancel", {
			entry_ids: [harness.entryId, "e_nope"],
		});
		expect(response.status).toBe(404);
		expect(harness.ctx.queue.get(job.id)?.state).toBe("queued");
		harness.close();
	});

	test("leaves the entry immediately re-analysable", async () => {
		const harness = testContext();
		harness.ctx.queue.enqueue("analyse", harness.entryId);
		await post(harness.app, "/api/entries/analyse/cancel", {
			entry_ids: [harness.entryId],
		});

		const response = await post(harness.app, "/api/entries/analyse", {
			entry_ids: [harness.entryId],
		});
		expect(QueueResultSchema.parse(await response.json()).queued).toEqual([
			harness.entryId,
		]);
		await harness.ctx.analyseRunner.idle();
		expect(getEntry(harness.db, harness.entryId)?.analysis_state).toBe(
			"analysed",
		);
		harness.close();
	});

	test("the repository route stops everything pending, naming what it stopped", async () => {
		const harness = testContext();
		harness.ctx.queue.enqueue("analyse", harness.entryId);

		const response = await post(
			harness.app,
			`/api/repos/${harness.repoId}/analyse/cancel`,
		);
		expect(RepoAnalyseCancelledSchema.parse(await response.json())).toEqual({
			cancelled: [harness.entryId],
		});
		expect(getEntry(harness.db, harness.entryId)?.analysis_state).toBe(
			"unanalysed",
		);
		harness.close();
	});

	test("the repository route reports an empty queue without error", async () => {
		const harness = testContext();
		const response = await post(
			harness.app,
			`/api/repos/${harness.repoId}/analyse/cancel`,
		);
		expect(response.status).toBe(200);
		expect(
			RepoAnalyseCancelledSchema.parse(await response.json()).cancelled,
		).toEqual([]);
		harness.close();
	});

	test("the repository route 404s for a repository that does not exist", async () => {
		const harness = testContext();
		const response = await post(
			harness.app,
			"/api/repos/r_nope/analyse/cancel",
		);
		expect(response.status).toBe(404);
		harness.close();
	});
});
