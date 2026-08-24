/**
 * A host's API endpoint and its web interface are different origins, and only
 * the API one is configured — `web_base` fills the gap when a host does not
 * state its own. Both shapes GitHub ships are covered: github.com serves its
 * API from an `api.` subdomain of the site, while an Enterprise Server install
 * hangs the API off a path under the site's own origin.
 */
export function webBaseFromApi(apiBase: string): string {
	const url = new URL(apiBase);
	if (url.hostname.startsWith("api.")) {
		url.hostname = url.hostname.slice("api.".length);
	}
	return url.origin;
}

/**
 * `name` is the configured `owner/repo`, which is also GitHub's own path.
 *
 * The host is taken whole rather than just its `web_base`, because a host row
 * outlives config: `applyConfig` is additive, so a host dropped from
 * config.yaml keeps its rows and never has the column filled. Deriving from
 * `api_base` there beats emitting a path with no origin, which the browser
 * would resolve against NOTAM itself.
 */
export function repoWebUrl(
	host: { web_base: string; api_base: string },
	name: string,
): string {
	return `${host.web_base || webBaseFromApi(host.api_base)}/${name}`;
}
