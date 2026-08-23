import { VERSION } from "../../version.ts";
import {
	LIST_MERGED_PRS,
	PULL_REQUEST_DETAIL,
	PULL_REQUEST_FILES,
} from "./queries.ts";
import {
	type GitHubClient,
	MAX_CHANGED_PATHS,
	type PRDetail,
	type PRPage,
	type PRRef,
	type RawPullRequest,
	type RepoRef,
} from "./types.ts";

export class GitHubError extends Error {
	override name = "GitHubError";
	constructor(
		message: string,
		readonly status: number | null = null,
	) {
		super(message);
	}
}

export type RateLimitPause = { waitMs: number; reason: string };

export type GitHubClientOptions = {
	endpoint: string;
	token: string;
	fetch?: typeof fetch;
	sleep?: (ms: number) => Promise<void>;
	now?: () => Date;
	/** Transport retries for 5xx and network failures (a single shared budget). Rate-limit pauses are not counted here. */
	maxRetries?: number;
	/** Pause proactively once the hourly quota drops to this many points. */
	rateLimitFloor?: number;
	/** Safety valve so a misbehaving host cannot pause forever. */
	maxRateLimitPauses?: number;
	onRateLimitPause?: (pause: RateLimitPause) => void;
};

type FilesConnection = {
	pageInfo: { hasNextPage: boolean; endCursor: string | null };
	nodes: ({ path: string } | null)[] | null;
};

type GraphQLEnvelope<T> = { data?: T; errors?: { message: string }[] };

const MIN_PAUSE_MS = 1_000;
/**
 * Safety valve for file-list pagination: bounds how many PULL_REQUEST_FILES
 * fetches fetchPRDetail will issue, so a server that reports hasNextPage
 * indefinitely (an unchanging cursor, or empty pages) cannot loop forever.
 * MAX_CHANGED_PATHS / 100 pages covers the cap exactly; +1 tolerates one
 * short/empty page along the way without falsely capping a normal PR.
 */
const MAX_FILE_PAGE_FETCHES = Math.ceil(MAX_CHANGED_PATHS / 100) + 1;

export class GraphQLGitHubClient implements GitHubClient {
	private readonly fetchImpl: typeof fetch;
	private readonly sleep: (ms: number) => Promise<void>;
	private readonly now: () => Date;
	private readonly maxRetries: number;
	private readonly rateLimitFloor: number;
	private readonly maxRateLimitPauses: number;

	constructor(private readonly options: GitHubClientOptions) {
		this.fetchImpl = options.fetch ?? fetch;
		this.sleep = options.sleep ?? ((ms) => Bun.sleep(ms));
		this.now = options.now ?? (() => new Date());
		this.maxRetries = options.maxRetries ?? 3;
		this.rateLimitFloor = options.rateLimitFloor ?? 10;
		this.maxRateLimitPauses = options.maxRateLimitPauses ?? 10;
	}

	async listMergedPRs(
		repo: RepoRef,
		options: { cursor?: string; pageSize?: number },
	): Promise<PRPage> {
		type Data = {
			repository: {
				pullRequests: {
					pageInfo: { hasNextPage: boolean; endCursor: string | null };
					nodes: (PRRef | null)[] | null;
				};
			} | null;
		};
		const data = await this.request<Data>(repo, LIST_MERGED_PRS, {
			owner: repo.owner,
			name: repo.name,
			pageSize: options.pageSize ?? 50,
			cursor: options.cursor ?? null,
		});
		const connection = data.repository?.pullRequests;
		if (!connection)
			throw new GitHubError(
				`repository ${repo.owner}/${repo.name} was not found or is not readable`,
			);
		return {
			nodes: (connection.nodes ?? []).filter(
				(node): node is PRRef => node !== null,
			),
			endCursor: connection.pageInfo.endCursor,
			hasNextPage: connection.pageInfo.hasNextPage,
		};
	}

	async fetchPRDetail(repo: RepoRef, number: number): Promise<PRDetail> {
		type Data = {
			repository: {
				pullRequest:
					| (RawPullRequest & { files: FilesConnection | null })
					| null;
			} | null;
		};
		const data = await this.request<Data>(repo, PULL_REQUEST_DETAIL, {
			owner: repo.owner,
			name: repo.name,
			number,
		});
		const node = data.repository?.pullRequest;
		if (!node)
			throw new GitHubError(
				`pull request ${repo.owner}/${repo.name}#${number} was not found`,
			);

		const { files, ...pullRequest } = node;
		let paths = pathsOf(files);
		let pageInfo = files?.pageInfo ?? { hasNextPage: false, endCursor: null };
		let filePageFetches = 0;
		let hitFetchCap = false;

		while (
			pageInfo.hasNextPage &&
			paths.length < MAX_CHANGED_PATHS &&
			pageInfo.endCursor
		) {
			if (filePageFetches >= MAX_FILE_PAGE_FETCHES) {
				hitFetchCap = true;
				break;
			}
			filePageFetches++;
			type FilesData = {
				repository: {
					pullRequest: { files: FilesConnection | null } | null;
				} | null;
			};
			const page = await this.request<FilesData>(repo, PULL_REQUEST_FILES, {
				owner: repo.owner,
				name: repo.name,
				number,
				filesCursor: pageInfo.endCursor,
			});
			const connection = page.repository?.pullRequest?.files ?? null;
			paths = paths.concat(pathsOf(connection));
			pageInfo = connection?.pageInfo ?? {
				hasNextPage: false,
				endCursor: null,
			};
		}

		// Any of these means we stopped before GitHub told us the list was
		// complete: we hit the cap, the list ran past it in one page, the
		// server still has more but gave no cursor to fetch it with, or the
		// safety valve cut off a page count.
		const pathsTruncated =
			paths.length > MAX_CHANGED_PATHS ||
			(pageInfo.hasNextPage && paths.length >= MAX_CHANGED_PATHS) ||
			(pageInfo.hasNextPage && !pageInfo.endCursor) ||
			hitFetchCap;
		return {
			pullRequest: pullRequest as RawPullRequest,
			changedPaths: paths.slice(0, MAX_CHANGED_PATHS),
			pathsTruncated,
		};
	}

	private async request<T>(
		repo: RepoRef,
		query: string,
		variables: Record<string, unknown>,
	): Promise<T> {
		const label = `${repo.owner}/${repo.name}`;
		let retries = 0;
		let pauses = 0;

		for (;;) {
			let response: Response;
			try {
				response = await this.fetchImpl(this.options.endpoint, {
					method: "POST",
					headers: {
						authorization: `Bearer ${this.options.token}`,
						"content-type": "application/json",
						"user-agent": `notam/${VERSION}`,
					},
					body: JSON.stringify({ query, variables }),
				});
			} catch (err) {
				// A thrown fetch (DNS failure, connection reset, ...) shares the
				// same retry budget and backoff as a 5xx — it is the single most
				// common transient failure in a long backfill, and there is only
				// one retry policy in this client.
				if (retries >= this.maxRetries) {
					throw new GitHubError(
						`${label}: network error: ${errorMessage(err)}`,
						null,
					);
				}
				retries++;
				await this.sleep(500 * 2 ** (retries - 1));
				continue;
			}

			if (response.status === 403 || response.status === 429) {
				const waitMs = this.pauseFor(response.headers);
				if (waitMs !== null && pauses < this.maxRateLimitPauses) {
					pauses++;
					this.options.onRateLimitPause?.({
						waitMs,
						reason: `${label}: API rate limit reached`,
					});
					await this.sleep(waitMs);
					continue;
				}
				throw new GitHubError(
					`${label}: ${response.status} ${await safeText(response)}`,
					response.status,
				);
			}

			if (response.status >= 500) {
				if (retries >= this.maxRetries) {
					throw new GitHubError(
						`${label}: ${response.status} ${await safeText(response)}`,
						response.status,
					);
				}
				retries++;
				await this.sleep(500 * 2 ** (retries - 1));
				continue;
			}

			if (!response.ok) {
				throw new GitHubError(
					`${label}: ${response.status} ${await safeText(response)}`,
					response.status,
				);
			}

			const envelope = (await response.json()) as GraphQLEnvelope<
				T & { rateLimit?: { remaining: number; resetAt: string } | null }
			>;
			if (envelope.errors?.length) {
				throw new GitHubError(
					`${label}: ${envelope.errors.map((e) => e.message).join("; ")}`,
				);
			}
			if (!envelope.data)
				throw new GitHubError(`${label}: GraphQL response contained no data`);

			const rateLimit = envelope.data.rateLimit;
			if (
				rateLimit &&
				rateLimit.remaining <= this.rateLimitFloor &&
				pauses < this.maxRateLimitPauses
			) {
				const waitMs = this.msUntil(new Date(rateLimit.resetAt));
				if (waitMs > 0) {
					pauses++;
					this.options.onRateLimitPause?.({
						waitMs,
						reason: `${label}: ${rateLimit.remaining} API points left, waiting for the quota to reset`,
					});
					await this.sleep(waitMs);
				}
			}
			return envelope.data;
		}
	}

	/** Null means "this 403 is not a rate limit" — a permissions failure, say. */
	private pauseFor(headers: Headers): number | null {
		const retryAfter = headers.get("retry-after");
		if (retryAfter) {
			const seconds = Number(retryAfter);
			if (Number.isFinite(seconds))
				return Math.max(MIN_PAUSE_MS, seconds * 1000);
		}
		const remaining = headers.get("x-ratelimit-remaining");
		const reset = headers.get("x-ratelimit-reset");
		if (remaining === "0" && reset) {
			const resetAt = new Date(Number(reset) * 1000);
			if (!Number.isNaN(resetAt.getTime())) return this.msUntil(resetAt);
		}
		return null;
	}

	private msUntil(target: Date): number {
		return Math.max(MIN_PAUSE_MS, target.getTime() - this.now().getTime());
	}
}

/** Never includes request internals (headers, body) — only the thrown error's own message. */
function errorMessage(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

function pathsOf(files: FilesConnection | null | undefined): string[] {
	return (files?.nodes ?? [])
		.filter((node): node is { path: string } => node !== null)
		.map((node) => node.path);
}

async function safeText(response: Response): Promise<string> {
	try {
		return (await response.text()).slice(0, 500);
	} catch {
		return "";
	}
}
