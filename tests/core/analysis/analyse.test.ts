import type { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	type AnalysisDeps,
	analyseEntry,
	createAnalyseHandler,
	queueEntries,
} from "../../../src/core/analysis/index.ts";
import type {
	ClaudeRunner,
	RunnerRequest,
	RunnerResult,
} from "../../../src/core/analysis/runner.ts";
import { transitionRule } from "../../../src/core/rules/state.ts";
import { JobQueue } from "../../../src/jobs/queue.ts";
import type { EntryRow, JobRow, RepoRow } from "../../../src/shared/types.ts";
import { getEntry } from "../../../src/store/entries.ts";
import {
	getPromotion,
	insertPromotion,
} from "../../../src/store/promotions.ts";
import { insertRules, listRulesByEntry } from "../../../src/store/rules.ts";
import { SEED_NOW, seedDatabase } from "../../helpers/seed.ts";

const RULE = {
	kind: "do",
	directive: "Always add a regression test alongside a bug fix.",
	rationale: "Reviewers kept asking for one.",
	scope_globs: ["services/payments/**"],
	confidence: 0.8,
	source_comment_urls: ["https://github.com/acme/mono/pull/4821#discussion_r1"],
};

function envelope(result: string): string {
	return JSON.stringify({ type: "result", is_error: false, result });
}

function replies(...results: RunnerResult[]): ClaudeRunner & {
	calls: RunnerRequest[];
} {
	const calls: RunnerRequest[] = [];
	const runner = async (request: RunnerRequest): Promise<RunnerResult> => {
		calls.push(request);
		const next = results[Math.min(calls.length - 1, results.length - 1)];
		if (!next) throw new Error("no canned reply left");
		return next;
	};
	return Object.assign(runner, { calls });
}

function ok(rules: unknown[]): RunnerResult {
	return {
		ok: true,
		stdout: envelope(`\`\`\`json\n${JSON.stringify(rules)}\n\`\`\``),
	};
}

let db: Database;
let repo: RepoRow;
let entry: EntryRow;
let slept: number[];

function deps(
	runner: ClaudeRunner,
	overrides: Partial<AnalysisDeps> = {},
): AnalysisDeps {
	return {
		db,
		runner,
		now: () => SEED_NOW,
		loadTemplate: async () => "PR {{number}}",
		backoffMs: (attempt) => attempt,
		sleep: async (ms) => {
			slept.push(ms);
		},
		...overrides,
	};
}

beforeEach(() => {
	const seeded = seedDatabase();
	db = seeded.db;
	repo = seeded.repo;
	entry = seeded.entry;
	slept = [];
});
afterEach(() => db.close());

describe("analyseEntry — success", () => {
	test("inserts drafts, derives their slugs, and marks the entry analysed", async () => {
		const runner = replies(ok([RULE]));
		const result = await analyseEntry(deps(runner), entry, repo);

		expect(result).toEqual({
			entryId: entry.id,
			state: "analysed",
			rules: 1,
			error: null,
		});
		const rules = listRulesByEntry(db, entry.id);
		expect(rules).toHaveLength(1);
		expect(rules[0]?.status).toBe("draft");
		expect(rules[0]?.file_slug).toBe(
			"always-add-a-regression-test-alongside-a-bug-fix",
		);
		const after = getEntry(db, entry.id);
		expect(after?.analysis_state).toBe("analysed");
		expect(after?.analysed_at).toBe(SEED_NOW.toISOString());
		expect(after?.last_error).toBeNull();
	});

	test("pipes the rendered template on stdin and the fixed instruction in argv", async () => {
		const runner = replies(ok([]));
		await analyseEntry(deps(runner), entry, repo);
		expect(runner.calls[0]?.stdin).toBe("PR 4821");
		expect(runner.calls[0]?.instruction).toContain("```json");
	});

	test("an empty array is a success, not a failure", async () => {
		const result = await analyseEntry(deps(replies(ok([]))), entry, repo);
		expect(result.state).toBe("analysed");
		expect(result.rules).toBe(0);
		expect(getEntry(db, entry.id)?.analysis_state).toBe("analysed");
	});

	test("passes a configured model and timeout through to the runner", async () => {
		const runner = replies(ok([]));
		await analyseEntry(
			deps(runner, { model: "claude-sonnet-5", timeoutMs: 9000 }),
			entry,
			repo,
		);
		expect(runner.calls[0]?.model).toBe("claude-sonnet-5");
		expect(runner.calls[0]?.timeoutMs).toBe(9000);
	});
});

describe("analyseEntry — re-analysis", () => {
	test("discards drafts and keeps every other status", async () => {
		const existing = insertRules(
			db,
			repo.id,
			entry.id,
			[
				{ ...RULE, kind: "do", directive: "old draft", file_slug: "old-draft" },
				{
					...RULE,
					kind: "do",
					directive: "old proposed",
					file_slug: "old-proposed",
				},
				{
					...RULE,
					kind: "do",
					directive: "old verified",
					file_slug: "old-verified",
				},
				{
					...RULE,
					kind: "do",
					directive: "old abandoned",
					file_slug: "old-abandoned",
				},
			],
			SEED_NOW,
		);
		const [, proposed, verified, abandoned] = existing;
		if (!proposed || !verified || !abandoned) throw new Error("missing rules");
		const promotion = insertPromotion(
			db,
			{ repo_id: repo.id, branch: "notam/rules-a", pr_number: 7, pr_url: "u" },
			SEED_NOW,
		);
		transitionRule(db, proposed.id, "proposed", SEED_NOW, {
			promotionId: promotion.id,
		});
		transitionRule(db, verified.id, "proposed", SEED_NOW, {
			promotionId: promotion.id,
		});
		transitionRule(db, verified.id, "verified", SEED_NOW);
		transitionRule(db, abandoned.id, "abandoned", SEED_NOW);

		await analyseEntry(deps(replies(ok([RULE]))), entry, repo);

		const directives = listRulesByEntry(db, entry.id).map((r) => r.directive);
		expect(directives).not.toContain("old draft");
		expect(directives).toContain("old proposed");
		expect(directives).toContain("old verified");
		expect(directives).toContain("old abandoned");
		expect(directives).toContain(RULE.directive);
	});

	test("never creates, amends, or closes a promotion", async () => {
		const promotion = insertPromotion(
			db,
			{ repo_id: repo.id, branch: "notam/rules-a", pr_number: 7, pr_url: "u" },
			SEED_NOW,
		);
		await analyseEntry(deps(replies(ok([RULE]))), entry, repo);
		expect(getPromotion(db, promotion.id)?.state).toBe("open");
		expect(
			db.query<{ c: number }, []>("SELECT COUNT(*) AS c FROM promotions").get()
				?.c,
		).toBe(1);
	});
});

describe("analyseEntry — validation failure", () => {
	test("repairs once, quoting the validator's error back to the model", async () => {
		const runner = replies(ok([{ ...RULE, confidence: 9 }]), ok([RULE]));
		const result = await analyseEntry(deps(runner), entry, repo);

		expect(result.state).toBe("analysed");
		expect(runner.calls).toHaveLength(2);
		expect(runner.calls[1]?.instruction).toContain("[0].confidence");
		expect(listRulesByEntry(db, entry.id)).toHaveLength(1);
	});

	test("a second validation failure marks the entry failed and stores the error", async () => {
		const runner = replies(ok([{ ...RULE, confidence: 9 }]));
		const result = await analyseEntry(deps(runner), entry, repo);

		expect(result.state).toBe("failed");
		expect(runner.calls).toHaveLength(2);
		const after = getEntry(db, entry.id);
		expect(after?.analysis_state).toBe("failed");
		expect(after?.last_error).toContain("[0].confidence");
	});

	test("a failed run leaves existing drafts alone rather than destroying them", async () => {
		insertRules(
			db,
			repo.id,
			entry.id,
			[{ ...RULE, kind: "do", directive: "old draft", file_slug: "old-draft" }],
			SEED_NOW,
		);
		await analyseEntry(
			deps(replies(ok([{ ...RULE, confidence: 9 }]))),
			entry,
			repo,
		);
		expect(listRulesByEntry(db, entry.id).map((r) => r.directive)).toEqual([
			"old draft",
		]);
	});
});

describe("analyseEntry — transport failure", () => {
	test("a timeout retries twice with backoff and then fails", async () => {
		const runner = replies({
			ok: false,
			kind: "timeout",
			message: "claude did not finish within 120000ms and was killed",
		});
		const result = await analyseEntry(deps(runner), entry, repo);

		expect(runner.calls).toHaveLength(3);
		expect(slept).toEqual([1, 2]);
		expect(result.state).toBe("failed");
		expect(getEntry(db, entry.id)?.last_error).toContain("did not finish");
	});

	test("a non-zero exit retries twice and then fails", async () => {
		const runner = replies({
			ok: false,
			kind: "exit",
			message: "claude exited with code 3",
		});
		const result = await analyseEntry(deps(runner), entry, repo);
		expect(runner.calls).toHaveLength(3);
		expect(result.state).toBe("failed");
	});

	test("a transport failure that later succeeds is not a failure", async () => {
		const runner = replies(
			{ ok: false, kind: "exit", message: "transient" },
			ok([RULE]),
		);
		const result = await analyseEntry(deps(runner), entry, repo);
		expect(result.state).toBe("analysed");
		expect(runner.calls).toHaveLength(2);
	});

	test("a missing claude CLI fails immediately — retrying cannot help", async () => {
		const runner = replies({
			ok: false,
			kind: "missing",
			message: "The claude CLI was not found on PATH.",
		});
		const result = await analyseEntry(deps(runner), entry, repo);
		expect(runner.calls).toHaveLength(1);
		expect(slept).toEqual([]);
		expect(result.state).toBe("failed");
	});

	test("a runner that throws outright leaves the entry failed, not stranded running", async () => {
		const runner: ClaudeRunner = async () => {
			throw new Error("runner exploded");
		};
		const result = await analyseEntry(deps(runner), entry, repo);

		expect(result.state).toBe("failed");
		expect(result.error).toContain("runner exploded");
		const after = getEntry(db, entry.id);
		expect(after?.analysis_state).toBe("failed");
		expect(after?.last_error).toContain("runner exploded");
	});

	test("an onProgress callback that throws leaves the entry failed, not stranded running", async () => {
		const runner = replies(ok([RULE]));
		const onProgress = (event: { type: string }) => {
			if (event.type === "attempt")
				throw new Error("progress handler exploded");
		};
		const result = await analyseEntry(
			deps(runner, { onProgress }),
			entry,
			repo,
		);

		expect(result.state).toBe("failed");
		expect(result.error).toContain("progress handler exploded");
		const after = getEntry(db, entry.id);
		expect(after?.analysis_state).toBe("failed");
		expect(after?.last_error).toContain("progress handler exploded");
	});

	test("a template that cannot be read fails the entry without spawning anything", async () => {
		const runner = replies(ok([RULE]));
		const result = await analyseEntry(
			deps(runner, {
				loadTemplate: async () => {
					throw new Error("Prompt template not found: /nope.md");
				},
			}),
			entry,
			repo,
		);
		expect(runner.calls).toHaveLength(0);
		expect(result.state).toBe("failed");
		expect(getEntry(db, entry.id)?.last_error).toContain("/nope.md");
	});
});

describe("createAnalyseHandler", () => {
	function job(targetId: string): JobRow {
		return {
			id: "j_1",
			kind: "analyse",
			target_id: targetId,
			state: "running",
			attempts: 1,
			error: null,
			created_at: SEED_NOW.toISOString(),
			started_at: SEED_NOW.toISOString(),
			finished_at: null,
		};
	}

	test("resolves on success", async () => {
		const handler = createAnalyseHandler(deps(replies(ok([RULE]))));
		await handler(job(entry.id));
		expect(getEntry(db, entry.id)?.analysis_state).toBe("analysed");
	});

	test("throws on failure so the job row carries the same error as the entry", async () => {
		const handler = createAnalyseHandler(
			deps(replies({ ok: false, kind: "missing", message: "no claude here" })),
		);
		await expect(handler(job(entry.id))).rejects.toThrow(/no claude here/);
		expect(getEntry(db, entry.id)?.last_error).toContain("no claude here");
	});

	test("throws for an unknown entry", async () => {
		const handler = createAnalyseHandler(deps(replies(ok([]))));
		await expect(handler(job("e_nope"))).rejects.toThrow(/e_nope/);
	});
});

describe("queueEntries", () => {
	test("enqueues and marks each entry queued", () => {
		const queue = new JobQueue(db, () => SEED_NOW);
		const result = queueEntries(db, queue, [entry.id]);
		expect(result.queued).toEqual([entry.id]);
		expect(result.skipped).toEqual([]);
		expect(getEntry(db, entry.id)?.analysis_state).toBe("queued");
		expect(queue.count("queued")).toBe(1);
	});

	test("skips an entry that already has a pending job", () => {
		const queue = new JobQueue(db, () => SEED_NOW);
		queueEntries(db, queue, [entry.id]);
		const second = queueEntries(db, queue, [entry.id]);
		expect(second.queued).toEqual([]);
		expect(second.skipped).toEqual([entry.id]);
		expect(queue.count("queued")).toBe(1);
	});
});
