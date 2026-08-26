import { afterEach, describe, expect, test } from "bun:test";
import type { ConfigResponse, HostTestResult } from "../../src/shared/api.ts";
import { archiveRepo, listRepos } from "../../src/store/repos.ts";
import { SEED_NOW } from "../helpers/seed.ts";
import { type TestHarness, testContext } from "./helpers.ts";

let harness: TestHarness | null = null;

function open(options: Parameters<typeof testContext>[0] = {}): TestHarness {
	harness = testContext(options);
	return harness;
}

afterEach(() => {
	harness?.close();
	harness = null;
});

async function readConfigRoute(h: TestHarness): Promise<ConfigResponse> {
	const response = await h.app.request("/api/config");
	expect(response.status).toBe(200);
	return (await response.json()) as ConfigResponse;
}

async function put(h: TestHarness, body: unknown): Promise<Response> {
	return await h.app.request("/api/config", {
		method: "PUT",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});
}

describe("GET /api/config", () => {
	test("returns the document, its hash, and where it lives", async () => {
		const h = open();

		const body = await readConfigRoute(h);

		expect(body.path).toBe(h.configPath);
		expect(body.hash).not.toBe("");
		expect(body.config.repos[0]?.name).toBe("acme/mono");
		expect(body.config.hosts[0]?.token_env).toBe("NOTAM_TEST_TOKEN");
	});

	test("reports whether each host's token variable is set, never its value", async () => {
		const h = open({ env: { NOTAM_TEST_TOKEN: "secret-value" } });

		const body = await readConfigRoute(h);

		expect(body.status.hosts).toEqual([
			{ id: "github", token_env: "NOTAM_TEST_TOKEN", token_present: true },
		]);
		expect(JSON.stringify(body)).not.toContain("secret-value");
	});

	test("reports a token variable that is unset", async () => {
		const h = open({ env: {} });

		expect((await readConfigRoute(h)).status.hosts[0]?.token_present).toBe(
			false,
		);
	});

	test("sees a change made to the file by hand, with no restart", async () => {
		const h = open();
		const before = await readConfigRoute(h);

		const edited = (await Bun.file(h.configPath).text()).replace(
			"window_days: 180",
			"window_days: 30",
		);
		await Bun.write(h.configPath, edited);

		const after = await readConfigRoute(h);
		expect(after.config.repos[0]?.window_days).toBe(30);
		expect(after.hash).not.toBe(before.hash);
	});

	test("carries what archiving each repository would cost", async () => {
		const h = open();

		const body = await readConfigRoute(h);

		expect(body.status.repos).toEqual([
			{
				id: h.repoId,
				host: "github",
				name: "acme/mono",
				entries: 1,
				rules: 0,
				verified_rules: 0,
			},
		]);
	});

	test("lists archived repositories with what it would take to add them back", async () => {
		const h = open();
		archiveRepo(h.db, h.repoId, SEED_NOW);

		const body = await readConfigRoute(h);

		expect(body.status.archived_repos).toHaveLength(1);
		expect(body.status.archived_repos[0]?.name).toBe("acme/mono");
		expect(body.status.archived_repos[0]?.entries).toBe(1);
	});
});

describe("PUT /api/config", () => {
	test("writes the file and applies the change without a restart", async () => {
		const h = open();
		const { config, hash } = await readConfigRoute(h);

		const response = await put(h, {
			hash,
			config: {
				...config,
				repos: [
					...config.repos,
					{
						host: "github",
						name: "acme/website",
						path_globs: [],
						default_branch: "main",
						window_days: 180,
					},
				],
			},
		});

		expect(response.status).toBe(200);
		expect(listRepos(h.db).map((r) => r.name)).toEqual([
			"acme/mono",
			"acme/website",
		]);
		expect(await Bun.file(h.configPath).text()).toContain("acme/website");
	});

	test("answers 409 when the file changed since the document was read", async () => {
		const h = open();
		const { config } = await readConfigRoute(h);

		const response = await put(h, { hash: "stale", config });

		expect(response.status).toBe(409);
		expect(await response.text()).toContain("changed on disk");
	});

	test("answers 400 for a document the schema rejects, and writes nothing", async () => {
		const h = open();
		const { config, hash } = await readConfigRoute(h);

		const response = await put(h, {
			hash,
			config: {
				...config,
				repos: [{ ...config.repos[0], name: "not-a-repo-name" }],
			},
		});

		expect(response.status).toBe(400);
		expect((await readConfigRoute(h)).hash).toBe(hash);
	});

	test("answers 400 for a prompt template that is not on disk", async () => {
		const h = open();
		const { config, hash } = await readConfigRoute(h);

		const response = await put(h, {
			hash,
			config: {
				...config,
				repos: [
					{ ...config.repos[0], prompt_template: "~/.notam/prompts/gone.md" },
				],
			},
		});

		expect(response.status).toBe(400);
		expect(await response.text()).toContain("Prompt template not found");
	});

	test("archives a repository dropped from the document, and can restore it", async () => {
		const h = open();
		const first = await readConfigRoute(h);

		await put(h, { hash: first.hash, config: { ...first.config, repos: [] } });

		const archived = await readConfigRoute(h);
		expect(archived.status.archived_repos.map((r) => r.name)).toEqual([
			"acme/mono",
		]);
		expect(listRepos(h.db)).toHaveLength(0);

		await put(h, { hash: archived.hash, config: first.config });

		expect((await readConfigRoute(h)).status.archived_repos).toEqual([]);
		expect(listRepos(h.db).map((r) => r.id)).toEqual([h.repoId]);
	});
});

describe("repository lifecycle routes", () => {
	test("renaming keeps the repository's id and its entries", async () => {
		const h = open();
		const { hash } = await readConfigRoute(h);

		const response = await h.app.request(`/api/repos/${h.repoId}/rename`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ name: "acme/monorepo", hash }),
		});

		expect(response.status).toBe(200);
		const after = (await response.json()) as ConfigResponse;
		expect(after.config.repos[0]?.name).toBe("acme/monorepo");
		expect(listRepos(h.db).map((r) => r.id)).toEqual([h.repoId]);
		expect(after.status.repos[0]?.entries).toBe(1);
	});

	test("deleting refuses a repository still named in the file", async () => {
		const h = open();

		const response = await h.app.request(`/api/repos/${h.repoId}`, {
			method: "DELETE",
		});

		expect(response.status).toBe(400);
		expect(await response.text()).toContain("still in config.yaml");
	});

	test("deleting destroys an archived repository", async () => {
		const h = open();
		archiveRepo(h.db, h.repoId, SEED_NOW);

		const response = await h.app.request(`/api/repos/${h.repoId}`, {
			method: "DELETE",
		});

		expect(response.status).toBe(200);
		expect((await readConfigRoute(h)).status.archived_repos).toEqual([]);
	});

	test("an archived repository is a 404 to the read routes", async () => {
		const h = open();
		archiveRepo(h.db, h.repoId, SEED_NOW);

		expect((await h.app.request(`/api/repos/${h.repoId}/entries`)).status).toBe(
			404,
		);
	});
});

describe("POST /api/hosts/:hostId/test", () => {
	test("reports the account a working token belongs to", async () => {
		const h = open({
			tokenCheck: async () => ({ ok: true, login: "dana", message: null }),
		});

		const response = await h.app.request("/api/hosts/github/test", {
			method: "POST",
		});

		expect(response.status).toBe(200);
		expect((await response.json()) as HostTestResult).toEqual({
			ok: true,
			login: "dana",
			message: null,
		});
	});

	test("reports a rejected token as an answer, not as a failure", async () => {
		const h = open({
			tokenCheck: async () => ({
				ok: false,
				login: null,
				message: "https://api.github.com answered 401 Unauthorized",
			}),
		});

		const response = await h.app.request("/api/hosts/github/test", {
			method: "POST",
		});

		expect(response.status).toBe(200);
		expect(((await response.json()) as HostTestResult).ok).toBe(false);
	});

	test("says which variable is missing when none is exported", async () => {
		const h = open({ env: {} });

		const response = await h.app.request("/api/hosts/github/test", {
			method: "POST",
		});

		const body = (await response.json()) as HostTestResult;
		expect(body.ok).toBe(false);
		expect(body.message).toContain("NOTAM_TEST_TOKEN");
	});

	test("is a 404 for a host that does not exist", async () => {
		const h = open();

		expect(
			(await h.app.request("/api/hosts/nope/test", { method: "POST" })).status,
		).toBe(404);
	});
});
