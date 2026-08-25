import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	ConfigError,
	defaultConfigPath,
	defaultDbPath,
	expandHome,
	loadConfig,
	notamDir,
	resolveToken,
} from "../../../src/core/config/load.ts";

const VALID = `
hosts:
  - id: github
    api_base: https://api.github.com
    graphql: https://api.github.com/graphql
    token_env: NOTAM_TEST_TOKEN
repos:
  - host: github
    name: acme/monolith
`;

let dir: string;
beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "notam-config-"));
});
afterEach(async () => {
	await rm(dir, { recursive: true, force: true });
});

describe("expandHome", () => {
	test("expands a leading tilde", () => {
		expect(expandHome("~/.notam/prompts/x.md", "/home/lead")).toBe(
			"/home/lead/.notam/prompts/x.md",
		);
	});

	test("leaves absolute paths alone", () => {
		expect(expandHome("/etc/notam.yaml", "/home/lead")).toBe("/etc/notam.yaml");
	});

	test("does not expand a tilde that is not a path prefix", () => {
		expect(expandHome("./~weird", "/home/lead")).toBe("./~weird");
	});
});

describe("default paths", () => {
	test("resolve under ~/.notam", () => {
		expect(notamDir("/home/lead")).toBe("/home/lead/.notam");
		expect(defaultConfigPath("/home/lead")).toBe(
			"/home/lead/.notam/config.yaml",
		);
		expect(defaultDbPath("/home/lead")).toBe("/home/lead/.notam/notam.db");
	});
});

describe("loadConfig", () => {
	test("parses a valid file", async () => {
		const path = join(dir, "config.yaml");
		await writeFile(path, VALID);
		const config = await loadConfig(path);
		expect(config.repos[0]?.name).toBe("acme/monolith");
		expect(config.server.port).toBe(4317);
	});

	test("throws a ConfigError naming the file when it is missing", async () => {
		const path = join(dir, "nope.yaml");
		await expect(loadConfig(path)).rejects.toThrow(ConfigError);
		await expect(loadConfig(path)).rejects.toThrow(path);
		await expect(loadConfig(path)).rejects.toThrow("notam init");
	});

	test("throws a ConfigError with the offending path on invalid content", async () => {
		const path = join(dir, "config.yaml");
		await writeFile(path, VALID.replace("acme/monolith", "monolith"));
		await expect(loadConfig(path)).rejects.toThrow(
			"repos[0].name: must be owner/repo",
		);
	});

	test("throws a ConfigError on malformed YAML rather than crashing", async () => {
		const path = join(dir, "config.yaml");
		await writeFile(path, "hosts:\n  - id: github\n   bad indentation: [\n");
		await expect(loadConfig(path)).rejects.toThrow(ConfigError);
	});
});

describe("resolveToken", () => {
	const host = {
		id: "github",
		label: "github",
		api_base: "https://api.github.com",
		graphql: "https://api.github.com/graphql",
		web_base: "https://github.com",
		token_env: "NOTAM_TEST_TOKEN",
	};

	test("returns the value of the named environment variable", () => {
		expect(resolveToken(host, { NOTAM_TEST_TOKEN: "ghp_secret" })).toBe(
			"ghp_secret",
		);
	});

	test("throws naming the variable when it is unset", () => {
		expect(() => resolveToken(host, {})).toThrow(ConfigError);
		expect(() => resolveToken(host, {})).toThrow("NOTAM_TEST_TOKEN");
	});

	test("treats an empty string as unset", () => {
		expect(() => resolveToken(host, { NOTAM_TEST_TOKEN: "" })).toThrow(
			"NOTAM_TEST_TOKEN",
		);
	});
});
