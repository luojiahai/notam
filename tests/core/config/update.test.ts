import type { Database } from "bun:sqlite";
import { beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	ConfigConflictError,
	ConfigValidationError,
	loadConfig,
	readConfig,
} from "../../../src/core/config/load.ts";
import {
	purgeHost,
	purgeRepo,
	renameHost,
	renameRepo,
	updateConfig,
} from "../../../src/core/config/update.ts";
import { applyConfig } from "../../../src/store/bootstrap.ts";
import { openDatabase } from "../../../src/store/db.ts";
import { archiveHost, getHost, listHosts } from "../../../src/store/hosts.ts";
import { applyMigrations } from "../../../src/store/migrations.ts";
import {
	archiveRepo,
	getRepo,
	listArchivedRepos,
	listRepos,
	setWatermark,
} from "../../../src/store/repos.ts";

const NOW = new Date("2026-08-23T09:00:00.000Z");

const ONE_REPO = `
hosts:
  - id: github
    api_base: https://api.github.com
    graphql: https://api.github.com/graphql
    token_env: NOTAM_GITHUB_TOKEN
repos:
  - host: github
    name: acme/mono
`;

let dir: string;
let path: string;
let db: Database;
let home: string;

beforeEach(async () => {
	home = mkdtempSync(join(tmpdir(), "notam-update-"));
	dir = home;
	path = join(dir, "config.yaml");
	await Bun.write(path, ONE_REPO);
	db = openDatabase(":memory:");
	applyMigrations(db);
	applyConfig(db, await loadConfig(path), NOW);
});

async function current() {
	return await readConfig(path);
}

describe("updateConfig", () => {
	test("writes the file and applies the change to the database at once", async () => {
		const { config, hash } = await current();

		const result = await updateConfig({
			db,
			path,
			home,
			now: NOW,
			expectedHash: hash,
			next: {
				...config,
				repos: [...config.repos, { host: "github", name: "acme/website" }],
			},
		});

		expect(result.config.repos).toHaveLength(2);
		expect(listRepos(db).map((r) => r.name)).toEqual([
			"acme/mono",
			"acme/website",
		]);
		expect((await loadConfig(path)).repos).toHaveLength(2);
		expect((await current()).hash).toBe(result.hash);
	});

	test("archives a repo dropped from the submitted document", async () => {
		const { config, hash } = await current();

		await updateConfig({
			db,
			path,
			home,
			now: NOW,
			expectedHash: hash,
			next: { ...config, repos: [] },
		});

		expect(listRepos(db)).toHaveLength(0);
		expect(listArchivedRepos(db).map((r) => r.name)).toEqual(["acme/mono"]);
	});

	test("restores an archived repo when it is added back", async () => {
		const before = listRepos(db)[0];
		if (!before) throw new Error("missing repo");
		const first = await current();
		await updateConfig({
			db,
			path,
			home,
			now: NOW,
			expectedHash: first.hash,
			next: { ...first.config, repos: [] },
		});

		const second = await current();
		await updateConfig({
			db,
			path,
			home,
			now: NOW,
			expectedHash: second.hash,
			next: first.config,
		});

		expect(listArchivedRepos(db)).toHaveLength(0);
		expect(getRepo(db, before.id)?.archived_at).toBeNull();
	});

	test("refuses a write based on a hash the file no longer has", async () => {
		const { config } = await current();

		expect(
			updateConfig({
				db,
				path,
				home,
				now: NOW,
				expectedHash: "stale",
				next: { ...config, repos: [] },
			}),
		).rejects.toThrow(ConfigConflictError);
	});

	test("leaves the file untouched when the submitted document is invalid", async () => {
		const { config, hash } = await current();

		expect(
			updateConfig({
				db,
				path,
				home,
				now: NOW,
				expectedHash: hash,
				next: { ...config, repos: [{ host: "github", name: "not-a-repo" }] },
			}),
		).rejects.toThrow();

		expect((await current()).hash).toBe(hash);
	});

	test("refuses a prompt template that is not on disk", async () => {
		const { config, hash } = await current();

		expect(
			updateConfig({
				db,
				path,
				home,
				now: NOW,
				expectedHash: hash,
				next: {
					...config,
					repos: [
						{
							host: "github",
							name: "acme/mono",
							prompt_template: "~/.notam/prompts/absent.md",
						},
					],
				},
			}),
		).rejects.toThrow(ConfigValidationError);
	});

	test("accepts a prompt template that is on disk", async () => {
		await Bun.write(join(home, ".notam", "prompts", "mono.md"), "# prompt\n");
		const { config, hash } = await current();

		const result = await updateConfig({
			db,
			path,
			home,
			now: NOW,
			expectedHash: hash,
			next: {
				...config,
				repos: [
					{
						host: "github",
						name: "acme/mono",
						prompt_template: "~/.notam/prompts/mono.md",
					},
				],
			},
		});

		expect(result.config.repos[0]?.prompt_template).toBe(
			"~/.notam/prompts/mono.md",
		);
	});

	test("rolls the database back when the file cannot be replaced", async () => {
		// A directory where the temporary file wants to go: the rename can never
		// happen, and the write fails inside the transaction.
		mkdirSync(`${path}.tmp`);
		const { config, hash } = await current();

		expect(
			updateConfig({
				db,
				path,
				home,
				now: NOW,
				expectedHash: hash,
				next: {
					...config,
					repos: [...config.repos, { host: "github", name: "acme/website" }],
				},
			}),
		).rejects.toThrow();

		expect(listRepos(db).map((r) => r.name)).toEqual(["acme/mono"]);
		expect((await current()).hash).toBe(hash);
	});

	test("leaves the replacement private", async () => {
		const { config, hash } = await current();

		await updateConfig({
			db,
			path,
			home,
			now: NOW,
			expectedHash: hash,
			next: { ...config, server: { port: 5000 } },
		});

		expect(statSync(path).mode & 0o777).toBe(0o600);
	});
});

describe("renameRepo", () => {
	test("keeps the row, its id, and its watermark", async () => {
		const before = listRepos(db)[0];
		if (!before) throw new Error("missing repo");
		setWatermark(db, before.id, "2026-08-21T10:00:00.000Z");
		const { hash } = await current();

		await renameRepo({
			db,
			path,
			id: before.id,
			next: "acme/monorepo",
			expectedHash: hash,
			now: NOW,
		});

		const after = getRepo(db, before.id);
		expect(after?.name).toBe("acme/monorepo");
		expect(after?.sync_watermark).toBe("2026-08-21T10:00:00.000Z");
		expect(listArchivedRepos(db)).toHaveLength(0);
		expect((await loadConfig(path)).repos[0]?.name).toBe("acme/monorepo");
	});

	test("refuses a name the same host already uses", async () => {
		const first = await current();
		await updateConfig({
			db,
			path,
			home,
			now: NOW,
			expectedHash: first.hash,
			next: {
				...first.config,
				repos: [
					...first.config.repos,
					{ host: "github", name: "acme/website" },
				],
			},
		});
		const mono = listRepos(db).find((r) => r.name === "acme/mono");
		if (!mono) throw new Error("missing repo");

		expect(
			renameRepo({
				db,
				path,
				id: mono.id,
				next: "acme/website",
				expectedHash: (await current()).hash,
				now: NOW,
			}),
		).rejects.toThrow(ConfigValidationError);
	});
});

describe("renameHost", () => {
	test("carries its repos across without new ids", async () => {
		const before = listRepos(db)[0];
		if (!before) throw new Error("missing repo");
		const { hash } = await current();

		await renameHost({
			db,
			path,
			id: "github",
			next: "gh",
			expectedHash: hash,
			now: NOW,
		});

		expect(listHosts(db).map((h) => h.id)).toEqual(["gh"]);
		expect(getRepo(db, before.id)?.host_id).toBe("gh");
		const saved = await loadConfig(path);
		expect(saved.hosts[0]?.id).toBe("gh");
		expect(saved.repos[0]?.host).toBe("gh");
	});
});

describe("purge", () => {
	test("refuses a repo still named in config", () => {
		const repo = listRepos(db)[0];
		if (!repo) throw new Error("missing repo");
		expect(() => purgeRepo(db, repo.id)).toThrow(ConfigValidationError);
	});

	test("destroys an archived repo", () => {
		const repo = listRepos(db)[0];
		if (!repo) throw new Error("missing repo");
		archiveRepo(db, repo.id, NOW);

		purgeRepo(db, repo.id);

		expect(getRepo(db, repo.id)).toBeNull();
	});

	test("refuses a host still named in config, and destroys an archived one", () => {
		expect(() => purgeHost(db, "github")).toThrow(ConfigValidationError);
		archiveHost(db, "github", NOW);

		purgeHost(db, "github");

		expect(getHost(db, "github")).toBeNull();
	});
});
