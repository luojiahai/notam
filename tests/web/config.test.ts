import { describe, expect, test } from "bun:test";
import type {
	ArchivedHost,
	ArchivedRepo,
	ConfigDocument,
} from "../../src/shared/api.ts";
import {
	addRepo,
	blankRepo,
	formatGlobs,
	isDirty,
	parseGlobs,
	removeHost,
	removeRepo,
	restoreHost,
	restoreRepo,
	updateHost,
	updateRepo,
} from "../../web/src/lib/config.ts";

const DOC: ConfigDocument = {
	hosts: [
		{
			id: "github",
			label: "GitHub",
			api_base: "https://api.github.com",
			graphql: "https://api.github.com/graphql",
			web_base: "https://github.com",
			token_env: "NOTAM_GITHUB_TOKEN",
		},
		{
			id: "ghe",
			label: "Acme GHES",
			api_base: "https://ghe.acme.net/api/v3",
			graphql: "https://ghe.acme.net/api/graphql",
			web_base: "https://ghe.acme.net",
			token_env: "NOTAM_GHE_TOKEN",
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
		{
			host: "ghe",
			name: "acme/internal",
			path_globs: [],
			default_branch: "main",
			window_days: 90,
		},
	],
	analysis: { concurrency: 3, timeout_seconds: 120 },
	server: { port: 4317 },
};

describe("globs", () => {
	test("reads one per line, ignoring blanks and stray spacing", () => {
		expect(parseGlobs("  a/**  \n\n b/** \n")).toEqual(["a/**", "b/**"]);
	});

	test("round-trips", () => {
		expect(parseGlobs(formatGlobs(["a/**", "b/**"]))).toEqual(["a/**", "b/**"]);
	});

	test("reads an empty box as no globs at all", () => {
		expect(parseGlobs("\n  \n")).toEqual([]);
	});
});

describe("editing", () => {
	test("updating a host leaves the others and the original alone", () => {
		const next = updateHost(DOC, 1, { label: "Renamed" });
		expect(next.hosts[1]?.label).toBe("Renamed");
		expect(next.hosts[0]).toEqual(DOC.hosts[0]);
		expect(DOC.hosts[1]?.label).toBe("Acme GHES");
	});

	test("updating a repo replaces only the field given", () => {
		const next = updateRepo(DOC, 0, { window_days: 30 });
		expect(next.repos[0]?.window_days).toBe(30);
		expect(next.repos[0]?.name).toBe("acme/mono");
	});

	test("removing a host takes its repositories with it", () => {
		const next = removeHost(DOC, 1);
		expect(next.hosts.map((h) => h.id)).toEqual(["github"]);
		// Left behind, the repo would name a host that is not there and the
		// document would no longer validate.
		expect(next.repos.map((r) => r.name)).toEqual(["acme/mono"]);
	});

	test("removing a host that is not there changes nothing", () => {
		expect(removeHost(DOC, 9)).toEqual(DOC);
	});

	test("removing a repo leaves its host", () => {
		const next = removeRepo(DOC, 0);
		expect(next.repos.map((r) => r.name)).toEqual(["acme/internal"]);
		expect(next.hosts).toHaveLength(2);
	});

	test("a new repo starts on the host it was added to", () => {
		const next = addRepo(DOC, blankRepo("ghe"));
		expect(next.repos[2]?.host).toBe("ghe");
		expect(next.repos[2]?.default_branch).toBe("main");
	});
});

describe("restoring", () => {
	const archivedRepo: ArchivedRepo = {
		id: "r1",
		host_id: "github",
		name: "acme/website",
		path_globs: ["site/**"],
		default_branch: "trunk",
		window_days: 45,
		prompt_template: null,
		archived_at: "2026-08-23T09:00:00.000Z",
		entries: 12,
		rules: 3,
		verified_rules: 1,
	};

	test("puts a repository back with the settings it had", () => {
		const next = restoreRepo(DOC, archivedRepo);
		expect(next.repos[2]).toEqual({
			host: "github",
			name: "acme/website",
			path_globs: ["site/**"],
			default_branch: "trunk",
			window_days: 45,
		});
	});

	test("carries a prompt template back when there was one", () => {
		const next = restoreRepo(DOC, {
			...archivedRepo,
			prompt_template: "~/.notam/prompts/site.md",
		});
		expect(next.repos[2]?.prompt_template).toBe("~/.notam/prompts/site.md");
	});

	test("puts a host back", () => {
		const archivedHost: ArchivedHost = {
			id: "old",
			label: "Old",
			api_base: "https://old.example/api/v3",
			graphql: "https://old.example/api/graphql",
			web_base: "https://old.example",
			token_env: "NOTAM_OLD_TOKEN",
			archived_at: "2026-08-23T09:00:00.000Z",
		};
		expect(restoreHost(DOC, archivedHost).hosts[2]?.id).toBe("old");
	});
});

describe("isDirty", () => {
	test("is false for an untouched draft", () => {
		expect(isDirty(DOC, DOC)).toBe(false);
	});

	test("is false for a structurally identical copy", () => {
		expect(isDirty(structuredClone(DOC), DOC)).toBe(false);
	});

	test("is true once a field changes", () => {
		expect(isDirty(updateRepo(DOC, 0, { window_days: 1 }), DOC)).toBe(true);
	});
});
