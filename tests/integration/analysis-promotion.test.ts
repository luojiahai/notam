import type { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	type AnalysisDeps,
	createAnalyseHandler,
	queueEntries,
} from "../../src/core/analysis/index.ts";
import type {
	ClaudeRunner,
	RunnerRequest,
	RunnerResult,
} from "../../src/core/analysis/runner.ts";
import type {
	CreatePRRequest,
	CreatePRResult,
	GitDataClient,
} from "../../src/core/github/types.ts";
import {
	type PromotionDeps,
	planPromotion,
	promoteRules,
} from "../../src/core/promotion/index.ts";
import { refreshPromotions } from "../../src/core/promotion/refresh.ts";
import { transitionRules } from "../../src/core/rules/state.ts";
import { runPool } from "../../src/jobs/pool.ts";
import { JobQueue } from "../../src/jobs/queue.ts";
import type {
	HostRow,
	PromotionState,
	RepoRow,
} from "../../src/shared/types.ts";
import {
	countEntriesByState,
	listEntriesByState,
	upsertEntry,
} from "../../src/store/entries.ts";
import { getPromotion } from "../../src/store/promotions.ts";
import { countRulesByStatus, listRules } from "../../src/store/rules.ts";
import { normalisedEntry, SEED_NOW, seedDatabase } from "../helpers/seed.ts";

/**
 * A runner that answers with one rule per PR, derived from the rendered stdin,
 * and reports the highest number of calls that were ever in flight at once —
 * which is how the concurrency assertion below knows the pool really parallelised.
 */
function goodRunner(): ClaudeRunner & { peak: () => number } {
	let inFlight = 0;
	let peak = 0;
	const runner = async (request: RunnerRequest): Promise<RunnerResult> => {
		inFlight++;
		peak = Math.max(peak, inFlight);
		await Bun.sleep(5);
		inFlight--;
		const number = request.stdin.replace("PR ", "");
		const rules = [
			{
				kind: "do",
				directive: `Rule for PR ${number}`,
				rationale: "Because the reviewers said so.",
				scope_globs: ["services/payments/**"],
				confidence: 0.9,
				source_comment_urls: [],
			},
		];
		return {
			ok: true,
			stdout: JSON.stringify({
				type: "result",
				is_error: false,
				result: `\`\`\`json\n${JSON.stringify(rules)}\n\`\`\``,
			}),
		};
	};
	return Object.assign(runner, { peak: () => peak });
}

function fakeGitData(existing: string[]) {
	const requests: CreatePRRequest[] = [];
	let prState: PromotionState = "open";
	const client: GitDataClient = {
		async listRuleFiles(): Promise<string[]> {
			return existing;
		},
		async createPRWithFiles(_repo, request): Promise<CreatePRResult> {
			requests.push(request);
			return {
				number: 501,
				url: "https://github.com/acme/mono/pull/501",
				branch: request.branch,
				commitSha: "commit-sha",
			};
		},
		async getPRState(): Promise<PromotionState> {
			return prState;
		},
	};
	return {
		client,
		requests,
		setState(next: PromotionState) {
			prState = next;
		},
	};
}

let db: Database;
let repo: RepoRow;

function analysisDeps(runner: ClaudeRunner): AnalysisDeps {
	return {
		db,
		runner,
		now: () => SEED_NOW,
		loadTemplate: async () => "PR {{number}}",
		backoffMs: () => 0,
		sleep: async () => {},
	};
}

function promotionDeps(client: GitDataClient): PromotionDeps {
	return {
		db,
		clientFor: (_host: HostRow) => client,
		now: () => SEED_NOW,
		suffix: () => "abc123",
	};
}

beforeEach(() => {
	const seeded = seedDatabase();
	db = seeded.db;
	repo = seeded.repo;
	// seedDatabase gives one entry (#4821); add two more so batching is real.
	upsertEntry(db, repo.id, normalisedEntry({ number: 4822 }), SEED_NOW);
	upsertEntry(db, repo.id, normalisedEntry({ number: 4823 }), SEED_NOW);
});
afterEach(() => db.close());

describe("analyse a repository and promote what it found", () => {
	test("unanalysed -> analysed -> proposed -> merged -> verified", async () => {
		// 1. Queue every unanalysed entry, exactly as the UI's bulk action will.
		const queue = new JobQueue(db, () => SEED_NOW);
		const unanalysed = listEntriesByState(db, repo.id, "unanalysed");
		expect(unanalysed).toHaveLength(3);
		const queued = queueEntries(
			db,
			queue,
			unanalysed.map((e) => e.id),
		);
		expect(queued.queued).toHaveLength(3);
		expect(countEntriesByState(db, repo.id).queued).toBe(3);

		// 2. Drain the queue through the real pool at the configured concurrency.
		const runner = goodRunner();
		const result = await runPool({
			queue,
			concurrency: 3,
			handlers: { analyse: createAnalyseHandler(analysisDeps(runner)) },
		});
		expect(result).toEqual({ succeeded: 3, failed: 0, retried: 0 });
		expect(runner.peak()).toBeGreaterThan(1);
		expect(countEntriesByState(db, repo.id)).toEqual({
			unanalysed: 0,
			queued: 0,
			running: 0,
			analysed: 3,
			failed: 0,
		});
		expect(countRulesByStatus(db, repo.id).draft).toBe(3);

		// 3. Pre-flight. One slug is already on the base branch.
		const drafts = listRules(db, repo.id, { status: "draft" });
		const git = fakeGitData(["rule-for-pr-4821.md"]);
		const plan = await planPromotion(
			promotionDeps(git.client),
			drafts.map((r) => r.id),
		);
		expect(plan.files).toHaveLength(3);
		expect(plan.collisions).toHaveLength(1);
		expect(plan.collisions[0]?.reason).toBe("base-branch");
		expect(plan.collisions[0]?.existing).toBe(
			".claude/rules/rule-for-pr-4821.md",
		);
		expect(plan.collisions[0]?.path).toBe(
			".claude/rules/rule-for-pr-4821-2.md",
		);

		// 4. Promote.
		const promotion = await promoteRules(promotionDeps(git.client), plan);
		expect(promotion.state).toBe("open");
		expect(promotion.branch).toBe("notam/rules-20260823-abc123");
		expect(git.requests[0]?.files).toHaveLength(3);
		expect(git.requests[0]?.files.map((f) => f.path).sort()).toEqual([
			".claude/rules/rule-for-pr-4821-2.md",
			".claude/rules/rule-for-pr-4822.md",
			".claude/rules/rule-for-pr-4823.md",
		]);
		expect(git.requests[0]?.body).toContain("#4821");
		expect(countRulesByStatus(db, repo.id)).toEqual({
			draft: 0,
			proposed: 3,
			verified: 0,
			abandoned: 0,
		});

		// 5. The team merges it. Verification stays manual.
		git.setState("merged");
		const refreshed = await refreshPromotions(promotionDeps(git.client));
		expect(refreshed.merged).toBe(1);
		expect(getPromotion(db, promotion.id)?.state).toBe("merged");
		expect(countRulesByStatus(db, repo.id).proposed).toBe(3);

		// 6. The lead confirms two and rejects one.
		const proposed = listRules(db, repo.id, { status: "proposed" });
		transitionRules(
			db,
			proposed.slice(0, 2).map((r) => r.id),
			"verified",
			SEED_NOW,
		);
		transitionRules(db, [proposed[2]?.id as string], "abandoned", SEED_NOW);
		expect(countRulesByStatus(db, repo.id)).toEqual({
			draft: 0,
			proposed: 0,
			verified: 2,
			abandoned: 1,
		});
	});

	test("a closed pull request returns every rule to draft, ready to re-propose", async () => {
		const queue = new JobQueue(db, () => SEED_NOW);
		queueEntries(
			db,
			queue,
			listEntriesByState(db, repo.id, "unanalysed").map((e) => e.id),
		);
		await runPool({
			queue,
			concurrency: 3,
			handlers: { analyse: createAnalyseHandler(analysisDeps(goodRunner())) },
		});

		const git = fakeGitData([]);
		const drafts = listRules(db, repo.id, { status: "draft" });
		const plan = await planPromotion(
			promotionDeps(git.client),
			drafts.map((r) => r.id),
		);
		const promotion = await promoteRules(promotionDeps(git.client), plan);

		git.setState("closed");
		const refreshed = await refreshPromotions(promotionDeps(git.client));

		expect(refreshed.closed).toBe(1);
		expect(refreshed.returnedToDraft).toBe(3);
		expect(getPromotion(db, promotion.id)?.state).toBe("closed");
		expect(countRulesByStatus(db, repo.id).draft).toBe(3);
		expect(
			listRules(db, repo.id, { status: "draft" }).every(
				(rule) => rule.promotion_id === null,
			),
		).toBe(true);
	});
});

describe("failure and recovery", () => {
	test("a failing entry records its error on both the entry and the job, and retries clean", async () => {
		const queue = new JobQueue(db, () => SEED_NOW);
		const [entry] = listEntriesByState(db, repo.id, "unanalysed");
		if (!entry) throw new Error("no entry");
		queueEntries(db, queue, [entry.id]);

		const failing: ClaudeRunner = async () => ({
			ok: false,
			kind: "exit",
			message: "claude exited with code 3: credit balance too low",
		});
		const first = await runPool({
			queue,
			concurrency: 1,
			handlers: { analyse: createAnalyseHandler(analysisDeps(failing)) },
		});

		expect(first.failed).toBe(1);
		const failedEntry = listEntriesByState(db, repo.id, "failed")[0];
		expect(failedEntry?.last_error).toContain("credit balance too low");
		expect(queue.list("failed")[0]?.error).toContain("credit balance too low");

		// a failed entry re-runs through the same path as any other: queue it again.
		queueEntries(db, queue, [entry.id]);
		const second = await runPool({
			queue,
			concurrency: 1,
			handlers: { analyse: createAnalyseHandler(analysisDeps(goodRunner())) },
		});

		expect(second.succeeded).toBe(1);
		expect(countEntriesByState(db, repo.id).failed).toBe(0);
		expect(
			listEntriesByState(db, repo.id, "analysed")[0]?.last_error,
		).toBeNull();
	});

	test("a batch survives a restart mid-run", async () => {
		const queue = new JobQueue(db, () => SEED_NOW);
		queueEntries(
			db,
			queue,
			listEntriesByState(db, repo.id, "unanalysed").map((e) => e.id),
		);

		// Process 1 stops after its first job.
		const controller = new AbortController();
		await runPool({
			queue,
			concurrency: 1,
			signal: controller.signal,
			handlers: { analyse: createAnalyseHandler(analysisDeps(goodRunner())) },
			onEvent: (event) => {
				if (event.type === "succeeded") controller.abort();
			},
		});
		expect(countEntriesByState(db, repo.id).analysed).toBe(1);
		expect(queue.count("queued")).toBe(2);

		// Process 2 opens the same database and finishes the job.
		const restarted = new JobQueue(db, () => SEED_NOW);
		restarted.resetStale();
		const result = await runPool({
			queue: restarted,
			concurrency: 3,
			handlers: { analyse: createAnalyseHandler(analysisDeps(goodRunner())) },
		});

		expect(result.succeeded).toBe(2);
		expect(countEntriesByState(db, repo.id).analysed).toBe(3);
		expect(countRulesByStatus(db, repo.id).draft).toBe(3);
	});
});
