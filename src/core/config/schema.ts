import { z } from "zod";
import { formatZodError } from "../../shared/zod.ts";
import { webBaseFromApi } from "../github/urls.ts";

const HostSchema = z.object({
	id: z.string().min(1),
	label: z.string().min(1).optional(),
	api_base: z.url(),
	graphql: z.url(),
	/** Where this host's repositories are browsed, as opposed to called. */
	web_base: z.url().optional(),
	token_env: z.string().min(1),
});

const RepoSchema = z.object({
	host: z.string().min(1),
	name: z.string().regex(/^[^/\s]+\/[^/\s]+$/, "must be owner/repo"),
	path_globs: z.array(z.string()).default([]),
	default_branch: z.string().min(1).default("main"),
	window_days: z.number().int().positive().default(180),
	prompt_template: z.string().min(1).optional(),
});

const AnalysisSchema = z.object({
	concurrency: z.number().int().min(1).max(16).default(3),
	timeout_seconds: z.number().int().positive().default(120),
	model: z.string().min(1).optional(),
});

const ServerSchema = z.object({
	port: z.number().int().min(1).max(65535).default(4317),
});

export const ConfigSchema = z
	.object({
		hosts: z.array(HostSchema).min(1),
		repos: z.array(RepoSchema).min(1),
		analysis: AnalysisSchema.prefault({}),
		server: ServerSchema.prefault({}),
	})
	.superRefine((config, ctx) => {
		const ids = new Set<string>();
		config.hosts.forEach((host, index) => {
			if (ids.has(host.id)) {
				ctx.addIssue({
					code: "custom",
					path: ["hosts", index, "id"],
					message: `duplicate host id "${host.id}"`,
				});
			}
			ids.add(host.id);
		});
		config.repos.forEach((repo, index) => {
			if (!ids.has(repo.host)) {
				ctx.addIssue({
					code: "custom",
					path: ["repos", index, "host"],
					message: `unknown host "${repo.host}"`,
				});
			}
		});
	})
	.transform((config) => ({
		...config,
		hosts: config.hosts.map((host) => ({
			...host,
			label: host.label ?? host.id,
			// Normalised here rather than at every join site: a base pasted from a
			// browser's address bar arrives with a trailing slash.
			web_base: (host.web_base ?? webBaseFromApi(host.api_base)).replace(
				/\/+$/,
				"",
			),
		})),
	}));

export type Config = z.output<typeof ConfigSchema>;
export type HostConfig = Config["hosts"][number];
export type RepoConfig = Config["repos"][number];

/** Renders zod issues as `hosts[0].api_base: Invalid URL`, one per line. */
export function formatConfigError(error: z.ZodError): string {
	return formatZodError(error);
}
