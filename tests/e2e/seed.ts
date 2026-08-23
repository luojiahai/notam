#!/usr/bin/env bun
/**
 * Seeds a NOTAM home for the end-to-end test: a config pointing at the stub,
 * a migrated database, and two unanalysed entries.
 *
 * A separate process because Playwright's runner is Node and cannot import
 * `bun:sqlite`.
 *
 * Usage: bun run tests/e2e/seed.ts <home> <stubBaseUrl>
 */
import { chmod, mkdir } from "node:fs/promises";
import {
	defaultConfigPath,
	defaultDbPath,
	loadConfig,
	notamDir,
} from "../../src/core/config/load.ts";
import type { NormalisedEntry } from "../../src/shared/types.ts";
import { applyConfig } from "../../src/store/bootstrap.ts";
import { upsertEntry } from "../../src/store/entries.ts";
import { migrateDatabase } from "../../src/store/migrations.ts";

const [home, stub] = Bun.argv.slice(2);
if (!home || !stub) throw new Error("usage: seed.ts <home> <stubBaseUrl>");

const config = `hosts:
  - id: github
    label: Stub
    api_base: ${stub}
    graphql: ${stub}/graphql
    token_env: NOTAM_E2E_TOKEN

repos:
  - host: github
    name: acme/mono
    path_globs: []
    default_branch: main

analysis:
  concurrency: 2
  timeout_seconds: 20

server:
  port: 4317
`;

await mkdir(notamDir(home), { recursive: true, mode: 0o700 });
await Bun.write(defaultConfigPath(home), config);
await chmod(defaultConfigPath(home), 0o600);

const parsed = await loadConfig(defaultConfigPath(home));
const { db } = await migrateDatabase(defaultDbPath(home));
const now = new Date("2026-08-23T09:00:00.000Z");
const { repos } = applyConfig(db, parsed, now);
const repo = repos[0];
if (!repo) throw new Error("applyConfig produced no repository");

function entry(number: number, title: string): NormalisedEntry {
	const url = `http://example.invalid/acme/mono/pull/${number}`;
	return {
		number,
		title,
		author: "dana",
		url,
		merged_at: "2026-08-20T10:00:00.000Z",
		updated_at: "2026-08-21T10:00:00.000Z",
		changed_paths: ["services/payments/round.ts"],
		paths_truncated: false,
		payload: {
			kind: "pr",
			number,
			title,
			body: "Rounds half-up instead of half-even.",
			url,
			author: "dana",
			labels: [],
			merged_at: "2026-08-20T10:00:00.000Z",
			updated_at: "2026-08-21T10:00:00.000Z",
			changed_paths: ["services/payments/round.ts"],
			paths_truncated: false,
			conversation_truncated: false,
			reviews: [],
			review_threads: [
				{
					path: "services/payments/round.ts",
					line: 42,
					resolved: true,
					comments: [
						{
							author: "sam",
							body: "Every payment fix here ships with a test reproducing the bug.",
							url: `${url}#discussion_r1`,
							created_at: "2026-08-20T09:00:00.000Z",
						},
					],
				},
			],
			comments: [],
		},
	};
}

upsertEntry(db, repo.id, entry(4821, "Fix rounding in payments"), now);
upsertEntry(db, repo.id, entry(4822, "Fix rounding in refunds"), now);
db.close();

console.log(`seeded ${home}`);
