import { chmodSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import type { Config } from "./schema.ts";

/**
 * Prepended to every file NOTAM writes, because `Bun.YAML.stringify` emits no
 * comments and this is the only place a hand-editor learns the rules.
 */
const HEADER = `# NOTAM configuration — ~/.notam/config.yaml
#
# NOTAM owns this file. Saving from the settings drawer rewrites it whole, so
# comments you add here do not survive. Editing it by hand works and is
# supported: NOTAM re-reads it on every request, and refuses to overwrite a
# change it has not seen.
#
# Tokens are NEVER stored here. Each host names the environment variable that
# supplies its token; export that variable in your shell profile.

`;

/**
 * What a config file with nothing in it yet looks like.
 *
 * The github.com host is filled in because every value in it is a constant —
 * making a first-time user type an API base and a GraphQL endpoint by hand
 * would be asking them to guess. There is no default repository: the settings
 * drawer is where the first one is added, and a placeholder that parses while
 * pointing at nothing is worse than an honest absence.
 */
export const DEFAULT_CONFIG = {
	hosts: [
		{
			id: "github",
			label: "GitHub",
			api_base: "https://api.github.com",
			graphql: "https://api.github.com/graphql",
			web_base: "https://github.com",
			token_env: "NOTAM_GITHUB_TOKEN",
		},
	],
	repos: [],
	analysis: { concurrency: 3, timeout_seconds: 120 },
	server: { port: 4317 },
};

/**
 * The exact document that gets serialised.
 *
 * Built key by key rather than handed the parsed config directly, for two
 * reasons: an optional the user never set must stay absent rather than appear
 * as `null`, and the order below is the order a reader sees.
 */
function toDocument(config: Config): unknown {
	return {
		hosts: config.hosts.map((host) => ({
			id: host.id,
			label: host.label,
			api_base: host.api_base,
			graphql: host.graphql,
			web_base: host.web_base,
			token_env: host.token_env,
		})),
		repos: config.repos.map((repo) => ({
			host: repo.host,
			name: repo.name,
			path_globs: repo.path_globs,
			default_branch: repo.default_branch,
			window_days: repo.window_days,
			...(repo.prompt_template === undefined
				? {}
				: { prompt_template: repo.prompt_template }),
		})),
		analysis: {
			concurrency: config.analysis.concurrency,
			timeout_seconds: config.analysis.timeout_seconds,
			...(config.analysis.model === undefined
				? {}
				: { model: config.analysis.model }),
		},
		server: { port: config.server.port },
	};
}

export function renderConfig(config: Config): string {
	return HEADER + Bun.YAML.stringify(toDocument(config));
}

/**
 * Replaces `path` atomically and privately.
 *
 * Written to a sibling and renamed over the target because a truncated write
 * would leave a config that no longer parses, and NOTAM never repairs a
 * malformed file — there would be no way back except a text editor. The mode is
 * set on the temporary file, since `rename` carries the source's permissions.
 */
export function writeConfigFileSync(path: string, contents: string): void {
	const temp = `${path}.tmp`;
	try {
		writeFileSync(temp, contents, { mode: 0o600 });
		chmodSync(temp, 0o600);
		renameSync(temp, path);
	} catch (error) {
		try {
			unlinkSync(temp);
		} catch {
			// Nothing to clean up: the write itself is what failed.
		}
		throw error;
	}
}
