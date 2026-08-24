import { describe, expect, test } from "bun:test";
import {
	ConfigSchema,
	formatConfigError,
} from "../../../src/core/config/schema.ts";

const MINIMAL = `
hosts:
  - id: github
    api_base: https://api.github.com
    graphql: https://api.github.com/graphql
    token_env: NOTAM_GITHUB_TOKEN
repos:
  - host: github
    name: acme/monolith
`;

function parse(yaml: string) {
	return ConfigSchema.safeParse(Bun.YAML.parse(yaml));
}

describe("ConfigSchema", () => {
	test("accepts a minimal config and fills every default", () => {
		const result = parse(MINIMAL);
		expect(result.success).toBe(true);
		if (!result.success) return;
		expect(result.data.repos[0]?.path_globs).toEqual([]);
		expect(result.data.repos[0]?.default_branch).toBe("main");
		expect(result.data.repos[0]?.window_days).toBe(180);
		expect(result.data.analysis.concurrency).toBe(3);
		expect(result.data.analysis.timeout_seconds).toBe(120);
		expect(result.data.analysis.model).toBeUndefined();
		expect(result.data.server.port).toBe(4317);
	});

	test("defaults a host label to its id", () => {
		const result = parse(MINIMAL);
		expect(result.success).toBe(true);
		if (!result.success) return;
		expect(result.data.hosts[0]?.label).toBe("github");
	});

	test("keeps an explicit host label", () => {
		const result = parse(
			`${MINIMAL}
`.replace(
				"token_env: NOTAM_GITHUB_TOKEN",
				"token_env: NOTAM_GITHUB_TOKEN\n    label: GitHub.com",
			),
		);
		expect(result.success).toBe(true);
		if (!result.success) return;
		expect(result.data.hosts[0]?.label).toBe("GitHub.com");
	});

	test("derives a host web_base from its api_base", () => {
		const result = parse(MINIMAL);
		expect(result.success).toBe(true);
		if (!result.success) return;
		expect(result.data.hosts[0]?.web_base).toBe("https://github.com");
	});

	test("keeps an explicit host web_base", () => {
		const result = parse(
			MINIMAL.replace(
				"token_env: NOTAM_GITHUB_TOKEN",
				"token_env: NOTAM_GITHUB_TOKEN\n    web_base: https://github.example.net",
			),
		);
		expect(result.success).toBe(true);
		if (!result.success) return;
		expect(result.data.hosts[0]?.web_base).toBe("https://github.example.net");
	});

	test("strips a trailing slash from an explicit web_base", () => {
		const result = parse(
			MINIMAL.replace(
				"token_env: NOTAM_GITHUB_TOKEN",
				"token_env: NOTAM_GITHUB_TOKEN\n    web_base: https://github.com/",
			),
		);
		expect(result.success).toBe(true);
		if (!result.success) return;
		expect(result.data.hosts[0]?.web_base).toBe("https://github.com");
	});

	test("rejects a repo referencing an undeclared host", () => {
		const result = parse(MINIMAL.replace("host: github", "host: ghe"));
		expect(result.success).toBe(false);
		if (result.success) return;
		expect(formatConfigError(result.error)).toContain(
			'repos[0].host: unknown host "ghe"',
		);
	});

	test("rejects duplicate host ids", () => {
		const result = parse(`
hosts:
  - id: github
    api_base: https://api.github.com
    graphql: https://api.github.com/graphql
    token_env: A
  - id: github
    api_base: https://ghe.acme.net/api/v3
    graphql: https://ghe.acme.net/api/graphql
    token_env: B
repos:
  - host: github
    name: acme/monolith
`);
		expect(result.success).toBe(false);
		if (result.success) return;
		expect(formatConfigError(result.error)).toContain(
			'hosts[1].id: duplicate host id "github"',
		);
	});

	test("rejects a repo name that is not owner/repo", () => {
		const result = parse(MINIMAL.replace("acme/monolith", "monolith"));
		expect(result.success).toBe(false);
		if (result.success) return;
		expect(formatConfigError(result.error)).toContain(
			"repos[0].name: must be owner/repo",
		);
	});

	test("rejects a non-URL api_base and names the path", () => {
		const result = parse(
			MINIMAL.replace("https://api.github.com\n", "not-a-url\n"),
		);
		expect(result.success).toBe(false);
		if (result.success) return;
		expect(formatConfigError(result.error)).toContain("hosts[0].api_base:");
	});

	test("rejects an empty hosts list", () => {
		const result = parse(
			MINIMAL.replace(/hosts:[\s\S]*?repos:/, "hosts: []\nrepos:"),
		);
		expect(result.success).toBe(false);
	});

	test("rejects a concurrency of zero", () => {
		const result = parse(`${MINIMAL}
analysis:
  concurrency: 0
`);
		expect(result.success).toBe(false);
		if (result.success) return;
		expect(formatConfigError(result.error)).toContain("analysis.concurrency:");
	});

	test("rejects a port outside the valid range", () => {
		const result = parse(`${MINIMAL}
server:
  port: 70000
`);
		expect(result.success).toBe(false);
	});

	test("accepts two hosts so github.com and GHES coexist", () => {
		const result = parse(`
hosts:
  - id: github
    api_base: https://api.github.com
    graphql: https://api.github.com/graphql
    token_env: NOTAM_GITHUB_TOKEN
  - id: ghe
    api_base: https://ghe.acme.net/api/v3
    graphql: https://ghe.acme.net/api/graphql
    token_env: NOTAM_GHE_TOKEN
repos:
  - host: github
    name: acme/monolith
    path_globs: ["services/payments/**", "libs/money/**"]
  - host: ghe
    name: acme/internal
    window_days: 90
    prompt_template: ~/.notam/prompts/payments.md
`);
		expect(result.success).toBe(true);
		if (!result.success) return;
		expect(result.data.repos).toHaveLength(2);
		expect(result.data.repos[1]?.window_days).toBe(90);
		expect(result.data.repos[1]?.prompt_template).toBe(
			"~/.notam/prompts/payments.md",
		);
	});
});
