import { VERSION } from "../../version.ts";
import { GitHubError } from "./client.ts";

/** Long enough that GitHub's own explanation survives intact for the CLI to print verbatim. */
const MAX_ERROR_BODY = 2000;

/** Where a release is looked up and downloaded from. */
export type ReleaseSource = {
	/** `owner/repo`. */
	repo: string;
	/** e.g. `https://api.github.com`. */
	apiBase: string;
	/** e.g. `https://github.com`; release assets hang off `/owner/repo/releases/download/`. */
	downloadBase: string;
};

export type ReleaseClientOptions = ReleaseSource & {
	fetch?: typeof fetch;
	sleep?: (ms: number) => Promise<void>;
	/** Transport retries for 5xx and network failures. Default 3. */
	maxRetries?: number;
};

/**
 * The same three names `install.sh` reads, so there is one vocabulary for
 * pointing NOTAM at somewhere other than the public repository — a fork, a
 * mirror, or the local server a test stands up.
 */
export function releaseSourceFromEnv(
	env: Record<string, string | undefined> = process.env,
): ReleaseSource {
	return {
		repo: env.NOTAM_REPO ?? "luojiahai/notam",
		apiBase: env.NOTAM_API_BASE ?? "https://api.github.com",
		downloadBase: env.NOTAM_DOWNLOAD_BASE ?? "https://github.com",
	};
}

/**
 * Reads published releases. Every request is anonymous, deliberately: the
 * token NOTAM holds belongs to whatever host `hosts[].token_env` names, which
 * may be an enterprise instance, and sending it to github.com would hand an
 * unrelated service a credential it was never issued for. Releases are public,
 * so there is nothing to authenticate for.
 */
export class ReleaseClient {
	private readonly apiBase: string;
	private readonly downloadBase: string;
	private readonly fetchImpl: typeof fetch;
	private readonly sleep: (ms: number) => Promise<void>;
	private readonly maxRetries: number;

	constructor(private readonly options: ReleaseClientOptions) {
		this.apiBase = options.apiBase.replace(/\/+$/, "");
		this.downloadBase = options.downloadBase.replace(/\/+$/, "");
		this.fetchImpl = options.fetch ?? fetch;
		this.sleep = options.sleep ?? ((ms) => Bun.sleep(ms));
		this.maxRetries = options.maxRetries ?? 3;
	}

	/**
	 * GitHub's `releases/latest` skips drafts and prereleases, which is the
	 * wanted behaviour: an update must never land someone on a release that was
	 * not cut for general use.
	 */
	async latestTag(signal?: AbortSignal): Promise<string> {
		const response = await this.request(
			`${this.apiBase}/repos/${this.options.repo}/releases/latest`,
			signal,
		);
		const body = (await response.json()) as { tag_name?: unknown };
		if (typeof body.tag_name !== "string" || body.tag_name === "") {
			throw new GitHubError(
				`The latest release of ${this.options.repo} reported no tag_name.`,
			);
		}
		return body.tag_name;
	}

	async downloadAsset(
		tag: string,
		name: string,
		signal?: AbortSignal,
	): Promise<Uint8Array> {
		const response = await this.request(this.assetUrl(tag, name), signal);
		return new Uint8Array(await response.arrayBuffer());
	}

	async downloadChecksums(tag: string, signal?: AbortSignal): Promise<string> {
		const response = await this.request(
			this.assetUrl(tag, "SHA256SUMS"),
			signal,
		);
		return await response.text();
	}

	private assetUrl(tag: string, name: string): string {
		return `${this.downloadBase}/${this.options.repo}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(name)}`;
	}

	/**
	 * Every request here is a GET of an immutable artefact, so retrying one is
	 * always safe. The budget matches the Git Data client's so the two agree on
	 * how patient NOTAM is with GitHub, even though they share no code.
	 */
	/**
	 * Waits, then honours an interrupt that arrived during the wait. The delay
	 * is bounded at a couple of seconds, so unlike the rate-limit pauses the
	 * GraphQL client sits out, there is nothing here worth racing the signal
	 * against — noticing on the way out is soon enough.
	 */
	private async backoff(
		retries: number,
		signal: AbortSignal | undefined,
	): Promise<void> {
		await this.sleep(500 * 2 ** (retries - 1));
		signal?.throwIfAborted();
	}

	private async request(url: string, signal?: AbortSignal): Promise<Response> {
		let retries = 0;
		for (;;) {
			let response: Response;
			try {
				response = await this.fetchImpl(url, {
					headers: { "user-agent": `notam/${VERSION}` },
					...(signal ? { signal } : {}),
				});
			} catch (err) {
				if (signal?.aborted) throw err;
				if (retries >= this.maxRetries) {
					throw new GitHubError(
						`Could not reach ${url}: ${err instanceof Error ? err.message : String(err)}`,
					);
				}
				retries++;
				await this.backoff(retries, signal);
				continue;
			}

			if (response.status >= 500 && retries < this.maxRetries) {
				retries++;
				await this.backoff(retries, signal);
				continue;
			}

			if (!response.ok) {
				throw new GitHubError(
					`${url}: ${response.status} ${await safeText(response)}`.trim(),
					response.status,
				);
			}

			return response;
		}
	}
}

async function safeText(response: Response): Promise<string> {
	try {
		return (await response.text()).slice(0, MAX_ERROR_BODY);
	} catch {
		return "";
	}
}
