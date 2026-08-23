import type { Database } from "bun:sqlite";
import type { Hono } from "hono";
import type {
	RunnerRequest,
	RunnerResult,
} from "../../src/core/analysis/runner.ts";
import type { Config } from "../../src/core/config/schema.ts";
import { GitHubError } from "../../src/core/github/client.ts";
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
	/** Whatever this holds is what a sync will find. */
	prs: PRDetail[] = [];
	/**
	 * Set to hold every hydration open, so a test can observe a sync that is
	 * genuinely mid-flight rather than one that finished before it looked.
	 * Resolve it to let the sync run on.
	 */
	hold: Promise<void> | null = null;
	/** Resolves once the first hydration has been entered. */
	readonly entered: Promise<void>;
	private announce!: () => void;

	constructor() {
		this.entered = new Promise<void>((resolve) => {
			this.announce = resolve;
		});
	}

	listMergedPRs(): Promise<PRPage> {
		return Promise.resolve({
			nodes: this.prs.map((detail) => ({
				number: detail.pullRequest.number,
				updatedAt: detail.pullRequest.updatedAt,
				mergedAt: detail.pullRequest.mergedAt,
			})),
			endCursor: null,
			hasNextPage: false,
		});
	}

	async fetchPRDetail(
		_repo: RepoRef,
		number: number,
		options: { signal?: AbortSignal } = {},
	): Promise<PRDetail> {
		this.announce();
		if (this.hold) {
			await Promise.race([
				this.hold,
				new Promise<never>((_resolve, reject) => {
					options.signal?.addEventListener("abort", () =>
						reject(options.signal?.reason),
					);
				}),
			]);
		}
		const found = this.prs.find(
			(detail) => detail.pullRequest.number === number,
		);
		if (!found) {
			throw new GitHubError(`no PR #${number}`, 404);
		}
		return found;
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
	github: FakeGitHubClient;
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
	const github = new FakeGitHubClient();
	const runnerCalls: RunnerRequest[] = [];
	const ctx = createContext({
		db: seeded.db,
		config: TEST_CONFIG,
		configPath: "/tmp/notam-test/config.yaml",
		dbPath: ":memory:",
		now: () => SEED_NOW,
		version: "test",
		claudeAvailable: options.claudeAvailable ?? true,
		githubFor: () => github,
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
		github,
		runnerCalls,
		close: () => {
			ctx.shutdown();
			seeded.db.close();
		},
	};
}
