import { describe, expect, test } from "bun:test";
import {
	QueueResultSchema,
	type ServerEvent,
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
