import type { Database } from "bun:sqlite";
import type { Hono } from "hono";
import type {
	RunnerRequest,
	RunnerResult,
} from "../../src/core/analysis/runner.ts";
import type { Config } from "../../src/core/config/schema.ts";
import type {
	CreatePRRequest,
	CreatePRResult,
	GitDataClient,
	GitHubClient,
	PRDetail,
	PRPage,
	RepoRef,
} from "../../src/core/github/types.ts";
import { createApp } from "../../src/server/app.ts";
import { type AppContext, createContext } from "../../src/server/context.ts";
import type { PromotionState } from "../../src/shared/types.ts";
import { SEED_NOW, seedDatabase } from "../helpers/seed.ts";

/** A config matching what `seedDatabase()` puts in the database. */
export const TEST_CONFIG: Config = {
	hosts: [
		{
			id: "github",
			label: "GitHub",
			api_base: "https://api.github.com",
			graphql: "https://api.github.com/graphql",
			token_env: "NOTAM_TEST_TOKEN",
		},
	],
	repos: [
		{
			host: "github",
			name: "acme/mono",
			path_globs: ["services/payments/**"],
			default_branch: "main",
			window_days: 180,
		},
	],
	analysis: { concurrency: 2, timeout_seconds: 30 },
	server: { port: 4317 },
};

export class FakeGitHubClient implements GitHubClient {
	listMergedPRs(): Promise<PRPage> {
		return Promise.resolve({ nodes: [], endCursor: null, hasNextPage: false });
	}
	fetchPRDetail(): Promise<PRDetail> {
		throw new Error("fetchPRDetail is not used by this test");
	}
}

export class FakeGitDataClient implements GitDataClient {
	ruleFiles: string[] = [];
	prState: PromotionState = "open";
	created: CreatePRRequest[] = [];
	nextNumber = 900;
	/** Set to make createPRWithFiles reject, so the push-failure path can be driven. */
	failWith: Error | null = null;

	listRuleFiles(_repo: RepoRef, _branch: string): Promise<string[]> {
		return Promise.resolve([...this.ruleFiles]);
	}
	createPRWithFiles(
		_repo: RepoRef,
		request: CreatePRRequest,
	): Promise<CreatePRResult> {
		if (this.failWith) return Promise.reject(this.failWith);
		this.created.push(request);
		const number = this.nextNumber++;
		return Promise.resolve({
			number,
			url: `https://github.com/acme/mono/pull/${number}`,
			branch: request.branch,
			commitSha: "c0ffee",
		});
	}
	getPRState(): Promise<PromotionState> {
		return Promise.resolve(this.prState);
	}
}

export type TestHarness = {
	ctx: AppContext;
	app: Hono;
	db: Database;
	repoId: string;
	entryId: string;
	gitData: FakeGitDataClient;
	runnerCalls: RunnerRequest[];
	close: () => void;
};

export type HarnessOptions = {
	/** What the fake `claude` returns. Defaults to one valid DO rule. */
	claude?: (request: RunnerRequest) => RunnerResult;
	claudeAvailable?: boolean;
};

export const DEFAULT_ANALYSER_STDOUT = JSON.stringify({
	result:
		'```json\n[{"kind":"do","directive":"Always add a regression test alongside a bug fix.","rationale":"Reviewers blocked untested payment fixes.","scope_globs":["services/payments/**"],"confidence":0.9,"source_comment_urls":["https://github.com/acme/mono/pull/4821#discussion_r1"]}]\n```',
});

/** A whole server over an in-memory database, with every outside edge faked. */
export function testContext(options: HarnessOptions = {}): TestHarness {
	const seeded = seedDatabase();
	const gitData = new FakeGitDataClient();
	const runnerCalls: RunnerRequest[] = [];
	const ctx = createContext({
		db: seeded.db,
		config: TEST_CONFIG,
		configPath: "/tmp/notam-test/config.yaml",
		dbPath: ":memory:",
		now: () => SEED_NOW,
		version: "test",
		claudeAvailable: options.claudeAvailable ?? true,
		githubFor: () => new FakeGitHubClient(),
		gitDataFor: () => gitData,
		claudeRunner: async (request) => {
			runnerCalls.push(request);
			return (
				options.claude?.(request) ?? {
					ok: true,
					stdout: DEFAULT_ANALYSER_STDOUT,
				}
			);
		},
	});
	return {
		ctx,
		app: createApp(ctx),
		db: seeded.db,
		repoId: seeded.repo.id,
		entryId: seeded.entry.id,
		gitData,
		runnerCalls,
		close: () => {
			ctx.shutdown();
			seeded.db.close();
		},
	};
}
