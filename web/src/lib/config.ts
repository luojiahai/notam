import type {
	ArchivedHost,
	ArchivedRepo,
	ConfigDocument,
} from "../../../src/shared/api.ts";

type Host = ConfigDocument["hosts"][number];
type Repo = ConfigDocument["repos"][number];

/**
 * Every edit the settings drawer makes to the document, as pure functions over
 * it.
 *
 * The drawer holds one draft and saves it whole, so each of these returns a new
 * document rather than mutating: what is on screen is what will be written, and
 * nothing reaches the file until Save.
 */

/** Path globs are one per line in the form, and an array in the document. */
export function parseGlobs(text: string): string[] {
	return text
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line !== "");
}

export function formatGlobs(globs: string[]): string {
	return globs.join("\n");
}

export function updateHost(
	doc: ConfigDocument,
	index: number,
	patch: Partial<Host>,
): ConfigDocument {
	return {
		...doc,
		hosts: doc.hosts.map((host, i) =>
			i === index ? { ...host, ...patch } : host,
		),
	};
}

export function addHost(doc: ConfigDocument, host: Host): ConfigDocument {
	return { ...doc, hosts: [...doc.hosts, host] };
}

/**
 * Removes a host and every repository on it.
 *
 * Leaving the repositories behind would produce a document the schema rejects
 * — a repo naming a host that is not there — so the removal has to reach them
 * whether or not the user was looking at that part of the form. They archive
 * rather than vanish, as any other removal does.
 */
export function removeHost(doc: ConfigDocument, index: number): ConfigDocument {
	const host = doc.hosts[index];
	if (host === undefined) return doc;
	return {
		...doc,
		hosts: doc.hosts.filter((_, i) => i !== index),
		repos: doc.repos.filter((repo) => repo.host !== host.id),
	};
}

export function updateRepo(
	doc: ConfigDocument,
	index: number,
	patch: Partial<Repo>,
): ConfigDocument {
	return {
		...doc,
		repos: doc.repos.map((repo, i) =>
			i === index ? { ...repo, ...patch } : repo,
		),
	};
}

export function addRepo(doc: ConfigDocument, repo: Repo): ConfigDocument {
	return { ...doc, repos: [...doc.repos, repo] };
}

export function removeRepo(doc: ConfigDocument, index: number): ConfigDocument {
	return { ...doc, repos: doc.repos.filter((_, i) => i !== index) };
}

/** What a new repository starts as, on whichever host is being added to. */
export function blankRepo(hostId: string): Repo {
	return {
		host: hostId,
		name: "",
		path_globs: [],
		default_branch: "main",
		window_days: 180,
	};
}

export function blankHost(): Host {
	return {
		id: "",
		label: "",
		api_base: "https://api.github.com",
		graphql: "https://api.github.com/graphql",
		web_base: "https://github.com",
		token_env: "NOTAM_GITHUB_TOKEN",
	};
}

/**
 * Restoring is adding back, not a separate operation.
 *
 * An archived row is only archived because it is absent from the file, so
 * putting the entry back is the whole of it: applyConfig matches the row that
 * is still there by `(host, name)` and clears the stamp, entries and rules
 * intact.
 */
export function restoreRepo(
	doc: ConfigDocument,
	archived: ArchivedRepo,
): ConfigDocument {
	return addRepo(doc, {
		host: archived.host_id,
		name: archived.name,
		path_globs: archived.path_globs,
		default_branch: archived.default_branch,
		window_days: archived.window_days,
		...(archived.prompt_template === null
			? {}
			: { prompt_template: archived.prompt_template }),
	});
}

export function restoreHost(
	doc: ConfigDocument,
	archived: ArchivedHost,
): ConfigDocument {
	return addHost(doc, {
		id: archived.id,
		label: archived.label,
		api_base: archived.api_base,
		graphql: archived.graphql,
		web_base: archived.web_base,
		token_env: archived.token_env,
	});
}

/** Whether the draft still says what the file says, which is what gates Save. */
export function isDirty(draft: ConfigDocument, saved: ConfigDocument): boolean {
	return JSON.stringify(draft) !== JSON.stringify(saved);
}
