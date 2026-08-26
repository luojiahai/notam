import { describe, expect, test } from "bun:test";
import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	configHash,
	ensureConfig,
	loadConfig,
	readConfig,
} from "../../../src/core/config/load.ts";
import { ConfigSchema } from "../../../src/core/config/schema.ts";
import {
	DEFAULT_CONFIG,
	renderConfig,
} from "../../../src/core/config/write.ts";

function tempDir(): string {
	return mkdtempSync(join(tmpdir(), "notam-config-"));
}

function parse(yaml: string) {
	const result = ConfigSchema.safeParse(Bun.YAML.parse(yaml));
	if (!result.success) throw new Error("fixture config is invalid");
	return result.data;
}

const MINIMAL = `
hosts:
  - id: github
    api_base: https://api.github.com
    graphql: https://api.github.com/graphql
    token_env: NOTAM_GITHUB_TOKEN
repos:
  - host: github
    name: acme/mono
`;

describe("renderConfig", () => {
	test("round-trips through the schema unchanged", () => {
		const config = parse(MINIMAL);
		expect(parse(renderConfig(config))).toEqual(config);
	});

	test("carries a header saying who owns the file", () => {
		const rendered = renderConfig(parse(MINIMAL));
		expect(rendered.startsWith("#")).toBe(true);
		expect(rendered).toContain("Tokens are NEVER stored here");
	});

	test("omits optional keys the config does not set", () => {
		const rendered = renderConfig(parse(MINIMAL));
		expect(rendered).not.toContain("prompt_template");
		expect(rendered).not.toContain("model:");
	});

	test("writes an optional key the config does set", () => {
		const rendered = renderConfig(
			parse(`${MINIMAL}    prompt_template: ~/.notam/prompts/mono.md\n`),
		);
		expect(rendered).toContain("prompt_template: ~/.notam/prompts/mono.md");
	});

	test("renders an empty repo list as a list, not as null", () => {
		const config = parse(MINIMAL.replace(/repos:[\s\S]*$/, "repos: []\n"));
		expect(parse(renderConfig(config)).repos).toEqual([]);
	});

	test("the default config is valid and has no repositories", () => {
		const parsed = parse(renderConfig(ConfigSchema.parse(DEFAULT_CONFIG)));
		expect(parsed.repos).toEqual([]);
		expect(parsed.hosts[0]?.id).toBe("github");
		expect(parsed.hosts[0]?.token_env).toBe("NOTAM_GITHUB_TOKEN");
	});
});

describe("ensureConfig", () => {
	test("creates a private config file when none exists", async () => {
		const path = join(tempDir(), "config.yaml");

		expect(await ensureConfig(path)).toBe(true);

		expect(statSync(path).mode & 0o777).toBe(0o600);
		const config = await loadConfig(path);
		expect(config.repos).toEqual([]);
		expect(config.hosts).toHaveLength(1);
	});

	test("leaves an existing file alone and reports that it did", async () => {
		const path = join(tempDir(), "config.yaml");
		await Bun.write(path, MINIMAL);

		expect(await ensureConfig(path)).toBe(false);

		expect(await Bun.file(path).text()).toBe(MINIMAL);
	});

	test("never repairs a malformed file", async () => {
		const path = join(tempDir(), "config.yaml");
		await Bun.write(path, "hosts: [\n");

		expect(await ensureConfig(path)).toBe(false);

		expect(await Bun.file(path).text()).toBe("hosts: [\n");
		expect(loadConfig(path)).rejects.toThrow(/not valid YAML/);
	});
});

describe("readConfig", () => {
	test("returns the parsed config with a hash of the bytes on disk", async () => {
		const path = join(tempDir(), "config.yaml");
		await Bun.write(path, MINIMAL);

		const { config, hash } = await readConfig(path);

		expect(config.repos[0]?.name).toBe("acme/mono");
		expect(hash).toBe(configHash(MINIMAL));
	});

	test("gives a different hash once the file changes", async () => {
		const path = join(tempDir(), "config.yaml");
		await Bun.write(path, MINIMAL);
		const before = (await readConfig(path)).hash;

		await Bun.write(path, MINIMAL.replace("acme/mono", "acme/other"));

		expect((await readConfig(path)).hash).not.toBe(before);
	});
});
