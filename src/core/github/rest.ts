import type { PromotionState } from "../../shared/types.ts";
import { VERSION } from "../../version.ts";
import { GitHubError } from "./client.ts";
import type {
	CreatePRRequest,
	CreatePRResult,
	GitDataClient,
	RepoRef,
} from "./types.ts";

/** Long enough that GitHub's own explanation survives intact for the UI to show verbatim. */
const MAX_ERROR_BODY = 2000;
const MIN_PAUSE_MS = 1_000;

export type RestClientOptions = {
	/** e.g. `https://api.github.com` or `https://ghe.acme.net/api/v3`. */
	apiBase: string;
	token: string;
	fetch?: typeof fetch;
	sleep?: (ms: number) => Promise<void>;
	/** Transport retries for 5xx and network failures. Default 3. */
	maxRetries?: number;
};

type ContentEntry = { type?: string; name?: string };

/**
 * Spec section 7: no clone. Reading a ref, a commit, and a tree and then writing
 * blobs costs a handful of requests regardless of repository size, and the same
 * endpoints exist on GHES.
 */
export class RestGitHubClient implements GitDataClient {
	private readonly base: string;
	private readonly fetchImpl: typeof fetch;
	private readonly sleep: (ms: number) => Promise<void>;
	private readonly maxRetries: number;

	constructor(private readonly options: RestClientOptions) {
		this.base = options.apiBase.replace(/\/+$/, "");
		this.fetchImpl = options.fetch ?? fetch;
		this.sleep = options.sleep ?? ((ms) => Bun.sleep(ms));
		this.maxRetries = options.maxRetries ?? 3;
	}

	async listRuleFiles(repo: RepoRef, branch: string): Promise<string[]> {
		try {
			const entries = await this.request<ContentEntry[] | ContentEntry>(
				repo,
				"GET",
				`/repos/${slug(repo)}/contents/.claude/rules?ref=${encodeURIComponent(branch)}`,
				undefined,
				{ idempotent: true },
			);
			if (!Array.isArray(entries)) return [];
			return entries
				.filter((entry) => entry.type === "file" && entry.name?.endsWith(".md"))
				.map((entry) => entry.name as string);
		} catch (error) {
			// A repository that has never adopted rules has no such directory. That
			// is the common case on a first promotion, not a failure.
			if (error instanceof GitHubError && error.status === 404) return [];
			throw error;
		}
	}

	async createPRWithFiles(
		repo: RepoRef,
		request: CreatePRRequest,
	): Promise<CreatePRResult> {
		// The base branch is interpolated unencoded: `git/ref/heads/release/2026`
		// is a legal hierarchical ref and encoding its slash would 404.
		const ref = await this.request<{ object: { sha: string } }>(
			repo,
			"GET",
			`/repos/${slug(repo)}/git/ref/heads/${request.baseBranch}`,
			undefined,
			{ idempotent: true },
		);
		const baseCommitSha = ref.object.sha;

		const commit = await this.request<{ tree: { sha: string } }>(
			repo,
			"GET",
			`/repos/${slug(repo)}/git/commits/${baseCommitSha}`,
			undefined,
			{ idempotent: true },
		);

		const tree: {
			path: string;
			mode: "100644";
			type: "blob";
			sha: string;
		}[] = [];
		for (const file of request.files) {
			const blob = await this.request<{ sha: string }>(
				repo,
				"POST",
				`/repos/${slug(repo)}/git/blobs`,
				{ content: file.content, encoding: "utf-8" },
				{ idempotent: true },
			);
			tree.push({
				path: file.path,
				mode: "100644",
				type: "blob",
				sha: blob.sha,
			});
		}

		const newTree = await this.request<{ sha: string }>(
			repo,
			"POST",
			`/repos/${slug(repo)}/git/trees`,
			{ base_tree: commit.tree.sha, tree },
			{ idempotent: true },
		);

		const newCommit = await this.request<{ sha: string }>(
			repo,
			"POST",
			`/repos/${slug(repo)}/git/commits`,
			{
				message: request.message,
				tree: newTree.sha,
				parents: [baseCommitSha],
			},
			{ idempotent: true },
		);

		await this.request(
			repo,
			"POST",
			`/repos/${slug(repo)}/git/refs`,
			{
				ref: `refs/heads/${request.branch}`,
				sha: newCommit.sha,
			},
			{ idempotent: false },
		);

		const pull = await this.request<{ number: number; html_url: string }>(
			repo,
			"POST",
			`/repos/${slug(repo)}/pulls`,
			{
				title: request.title,
				head: request.branch,
				base: request.baseBranch,
				body: request.body,
			},
			{ idempotent: false },
		);

		return {
			number: pull.number,
			url: pull.html_url,
			branch: request.branch,
			commitSha: newCommit.sha,
		};
	}

	async getPRState(repo: RepoRef, number: number): Promise<PromotionState> {
		const pull = await this.request<{ state: string; merged?: boolean }>(
			repo,
			"GET",
			`/repos/${slug(repo)}/pulls/${number}`,
			undefined,
			{ idempotent: true },
		);
		if (pull.merged === true) return "merged";
		return pull.state === "open" ? "open" : "closed";
	}

	/**
	 * `idempotent` gates the transport retry loop, not the caller's own
	 * business logic. `GET` and the three content-addressed Git Data POSTs
	 * (`blobs`, `trees`, `commits`) are safe to re-issue on a network error or a
	 * 5xx: the same content always yields the same sha. `POST /git/refs` and
	 * `POST /pulls` are not — re-issuing either one after the response was lost
	 * risks creating a second ref or a second pull request, so those two callers
	 * pass `idempotent: false` and this loop makes exactly one attempt.
	 */
	private async request<T>(
		repo: RepoRef,
		method: "GET" | "POST",
		path: string,
		body?: unknown,
		options: { idempotent?: boolean } = {},
	): Promise<T> {
		const idempotent = options.idempotent ?? method === "GET";
		const label = `${repo.owner}/${repo.name}`;
		let retries = 0;
		let paused = false;

		for (;;) {
			let response: Response;
			try {
				response = await this.fetchImpl(`${this.base}${path}`, {
					method,
					headers: {
						accept: "application/vnd.github+json",
						authorization: `Bearer ${this.options.token}`,
						"user-agent": `notam/${VERSION}`,
						...(body === undefined
							? {}
							: { "content-type": "application/json" }),
					},
					...(body === undefined ? {} : { body: JSON.stringify(body) }),
				});
			} catch (err) {
				if (!idempotent || retries >= this.maxRetries) {
					throw new GitHubError(
						`${label}: network error: ${err instanceof Error ? err.message : String(err)}`,
					);
				}
				retries++;
				await this.sleep(500 * 2 ** (retries - 1));
				continue;
			}

			if (response.status === 429 && !paused) {
				const retryAfter = Number(response.headers.get("retry-after"));
				if (Number.isFinite(retryAfter) && retryAfter > 0) {
					paused = true;
					await this.sleep(Math.max(MIN_PAUSE_MS, retryAfter * 1000));
					continue;
				}
			}

			if (idempotent && response.status >= 500 && retries < this.maxRetries) {
				retries++;
				await this.sleep(500 * 2 ** (retries - 1));
				continue;
			}

			if (!response.ok) {
				// Verbatim, per spec section 7: a protected branch or a missing
				// scope is something the user has to read to act on.
				throw new GitHubError(
					`${label}: ${response.status} ${await safeText(response)}`,
					response.status,
				);
			}

			const text = await response.text();
			return (text ? JSON.parse(text) : null) as T;
		}
	}
}

function slug(repo: RepoRef): string {
	return `${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}`;
}

async function safeText(response: Response): Promise<string> {
	try {
		return (await response.text()).slice(0, MAX_ERROR_BODY);
	} catch {
		return "";
	}
}
