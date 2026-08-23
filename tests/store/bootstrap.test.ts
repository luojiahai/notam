import type { Database } from "bun:sqlite";
import { beforeEach, describe, expect, test } from "bun:test";
import { ConfigSchema } from "../../src/core/config/schema.ts";
import { applyConfig } from "../../src/store/bootstrap.ts";
import { openDatabase } from "../../src/store/db.ts";
import { getHost, listHosts } from "../../src/store/hosts.ts";
import { applyMigrations } from "../../src/store/migrations.ts";
import { listRepos, setWatermark } from "../../src/store/repos.ts";

const NOW = new Date("2026-08-23T09:00:00.000Z");

function config(yaml: string) {
	const parsed = ConfigSchema.safeParse(Bun.YAML.parse(yaml));
	if (!parsed.success) throw new Error("fixture config is invalid");
	return parsed.data;
}

const TWO_HOSTS = `
hosts:
  - id: github
    api_base: https://api.github.com
    graphql: https://api.github.com/graphql
    token_env: NOTAM_GITHUB_TOKEN
  - id: ghe
    label: Acme GHES
    api_base: https://ghe.acme.net/api/v3
    graphql: https://ghe.acme.net/api/graphql
    token_env: NOTAM_GHE_TOKEN
repos:
  - host: github
    name: acme/monolith
    path_globs: ["services/payments/**"]
  - host: ghe
    name: acme/internal
    window_days: 90
`;

const GITHUB_HOST_EDITED = `
hosts:
  - id: github
    label: GitHub (Edited)
    api_base: https://api.github.edited
    graphql: https://api.github.com/graphql
    token_env: NOTAM_GITHUB_TOKEN_V2
  - id: ghe
    label: Acme GHES
    api_base: https://ghe.acme.net/api/v3
    graphql: https://ghe.acme.net/api/graphql
    token_env: NOTAM_GHE_TOKEN
repos:
  - host: github
    name: acme/monolith
    path_globs: ["services/payments/**"]
  - host: ghe
    name: acme/internal
    window_days: 90
`;

let db: Database;
beforeEach(() => {
	db = openDatabase(":memory:");
	applyMigrations(db);
});

describe("applyConfig", () => {
	test("creates a row per host and per repo", () => {
		const result = applyConfig(db, config(TWO_HOSTS), NOW);
		expect(result.hosts).toHaveLength(2);
		expect(result.repos).toHaveLength(2);
		expect(listHosts(db).map((h) => h.id)).toEqual(["ghe", "github"]);
		expect(listRepos(db).map((r) => r.name)).toEqual([
			"acme/internal",
			"acme/monolith",
		]);
	});

	test("defaults a missing label to the host id and keeps an explicit one", () => {
		applyConfig(db, config(TWO_HOSTS), NOW);
		const hosts = listHosts(db);
		expect(hosts.find((h) => h.id === "github")?.label).toBe("github");
		expect(hosts.find((h) => h.id === "ghe")?.label).toBe("Acme GHES");
	});

	test("stores path globs as JSON and reads them back as an array", () => {
		applyConfig(db, config(TWO_HOSTS), NOW);
		const repo = listRepos(db).find((r) => r.name === "acme/monolith");
		expect(repo?.path_globs).toEqual(["services/payments/**"]);
		expect(repo?.window_days).toBe(180);
	});

	test("is idempotent — reapplying the same config changes no ids", () => {
		const first = applyConfig(db, config(TWO_HOSTS), NOW);
		const second = applyConfig(
			db,
			config(TWO_HOSTS),
			new Date("2026-09-01T00:00:00.000Z"),
		);
		expect(second.repos.map((r) => r.id)).toEqual(first.repos.map((r) => r.id));
		expect(listRepos(db)).toHaveLength(2);
	});

	test("updates a repo's settings without disturbing its watermark", () => {
		const { repos } = applyConfig(db, config(TWO_HOSTS), NOW);
		const mono = repos.find((r) => r.name === "acme/monolith");
		if (!mono) throw new Error("missing repo");
		setWatermark(db, mono.id, "2026-08-21T10:00:00.000Z");
		applyConfig(
			db,
			config(
				TWO_HOSTS.replace('["services/payments/**"]', '["libs/money/**"]'),
			),
			NOW,
		);
		const updated = listRepos(db).find((r) => r.name === "acme/monolith");
		expect(updated?.path_globs).toEqual(["libs/money/**"]);
		expect(updated?.sync_watermark).toBe("2026-08-21T10:00:00.000Z");
	});

	test("updates an existing host's label, api_base, and token_env without creating a duplicate or disturbing its repos", () => {
		const first = applyConfig(db, config(TWO_HOSTS), NOW);
		const mono = first.repos.find((r) => r.name === "acme/monolith");
		if (!mono) throw new Error("missing repo");

		applyConfig(db, config(GITHUB_HOST_EDITED), NOW);

		const hostsAfter = listHosts(db);
		expect(hostsAfter).toHaveLength(2);
		const github = getHost(db, "github");
		expect(github?.id).toBe("github");
		expect(github?.label).toBe("GitHub (Edited)");
		expect(github?.api_base).toBe("https://api.github.edited");
		expect(github?.token_env).toBe("NOTAM_GITHUB_TOKEN_V2");

		const reposAfter = listRepos(db);
		expect(reposAfter).toHaveLength(2);
		const monoAfter = reposAfter.find((r) => r.name === "acme/monolith");
		expect(monoAfter?.id).toBe(mono.id);
		expect(monoAfter?.host_id).toBe("github");
		expect(monoAfter?.path_globs).toEqual(["services/payments/**"]);
	});

	test("leaves rows for repos dropped from config in place", () => {
		applyConfig(db, config(TWO_HOSTS), NOW);
		const trimmed = TWO_HOSTS.replace(
			/ {2}- host: ghe\n {4}name: acme\/internal\n {4}window_days: 90\n/,
			"",
		);
		applyConfig(db, config(trimmed), NOW);
		expect(listRepos(db)).toHaveLength(2);
	});
});
