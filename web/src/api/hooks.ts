import {
	type UseQueryResult,
	useMutation,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { z } from "zod";
import {
	type AnalysisState,
	type CancelResult,
	CancelResultSchema,
	type ConfigDocument,
	type ConfigResponse,
	ConfigResponseSchema,
	type EntriesResponse,
	EntriesResponseSchema,
	type EntryDetail,
	EntryDetailSchema,
	type HostTestResult,
	HostTestResultSchema,
	type Meta,
	MetaSchema,
	PromotionPlanSchema,
	type PromotionPlanView,
	type PromotionSummary,
	PromotionSummarySchema,
	type QueueResult,
	QueueResultSchema,
	RefreshSummarySchema,
	type RefreshSummaryView,
	type RepoAnalyseCancelled,
	RepoAnalyseCancelledSchema,
	type RepoSummary,
	RepoSummarySchema,
	type RuleDetail,
	RuleDetailSchema,
	type RuleStatus,
	type RuleSummary,
	RuleSummarySchema,
	type RulesResponse,
	RulesResponseSchema,
	type SyncCancelled,
	SyncCancelledSchema,
	type SyncStarted,
	SyncStartedSchema,
} from "../../../src/shared/api.ts";
import { post, request } from "./client.ts";

export const queryKeys = {
	meta: ["meta"] as const,
	repos: ["repos"] as const,
	entries: (repoId: string, state: string, q: string) =>
		["entries", repoId, state, q] as const,
	entry: (entryId: string) => ["entry", entryId] as const,
	rules: (repoId: string, status: string, q: string) =>
		["rules", repoId, status, q] as const,
	rule: (ruleId: string) => ["rule", ruleId] as const,
	promotions: (repoId: string) => ["promotions", repoId] as const,
	config: ["config"] as const,
};

function query(params: Record<string, string>): string {
	const search = new URLSearchParams();
	for (const [key, value] of Object.entries(params)) {
		if (value !== "") search.set(key, value);
	}
	const rendered = search.toString();
	return rendered === "" ? "" : `?${rendered}`;
}

export function useMeta(): UseQueryResult<Meta> {
	return useQuery({
		queryKey: queryKeys.meta,
		queryFn: () => request(MetaSchema, "/api/meta"),
		staleTime: Number.POSITIVE_INFINITY,
	});
}

export function useRepos(): UseQueryResult<RepoSummary[]> {
	return useQuery({
		queryKey: queryKeys.repos,
		queryFn: () => request(z.array(RepoSummarySchema), "/api/repos"),
	});
}

export function useEntries(
	repoId: string | null,
	state: AnalysisState | "",
	q: string,
): UseQueryResult<EntriesResponse> {
	return useQuery({
		enabled: repoId !== null,
		queryKey: queryKeys.entries(repoId ?? "", state, q),
		queryFn: () =>
			request(
				EntriesResponseSchema,
				`/api/repos/${repoId}/entries${query({ state, q })}`,
			),
	});
}

export function useEntry(entryId: string | null): UseQueryResult<EntryDetail> {
	return useQuery({
		enabled: entryId !== null,
		queryKey: queryKeys.entry(entryId ?? ""),
		queryFn: () => request(EntryDetailSchema, `/api/entries/${entryId}`),
	});
}

export function useRules(
	repoId: string | null,
	status: RuleStatus | "",
	q: string,
): UseQueryResult<RulesResponse> {
	return useQuery({
		enabled: repoId !== null,
		queryKey: queryKeys.rules(repoId ?? "", status, q),
		queryFn: () =>
			request(
				RulesResponseSchema,
				`/api/repos/${repoId}/rules${query({ status, q })}`,
			),
	});
}

export function useRule(ruleId: string | null): UseQueryResult<RuleDetail> {
	return useQuery({
		enabled: ruleId !== null,
		queryKey: queryKeys.rule(ruleId ?? ""),
		queryFn: () => request(RuleDetailSchema, `/api/rules/${ruleId}`),
	});
}

export function usePromotions(
	repoId: string | null,
): UseQueryResult<PromotionSummary[]> {
	return useQuery({
		enabled: repoId !== null,
		queryKey: queryKeys.promotions(repoId ?? ""),
		queryFn: () =>
			request(
				z.array(PromotionSummarySchema),
				`/api/repos/${repoId}/promotions`,
			),
	});
}

/**
 * Mutations invalidate on success as well as relying on the SSE stream. The
 * stream is the live channel, but a browser whose EventSource dropped must
 * still see the result of its own click.
 *
 * A mutation that moves a row invalidates the detail family beside the list
 * family — `["rule"]` next to `["rules"]`, `["entry"]` next to `["entries"]`.
 * The two are separate key families, so `["rules"]` does not prefix-match
 * `["rule", id]`: without the second call an open panel keeps rendering the
 * status the row has just left, and with `refetchOnWindowFocus` off nothing
 * ever refetches it.
 */
export function useSync() {
	const client = useQueryClient();
	return useMutation<SyncStarted, Error, string>({
		mutationFn: (repoId) =>
			post(SyncStartedSchema, `/api/repos/${repoId}/sync`, {}),
		onSuccess: () => {
			void client.invalidateQueries({ queryKey: queryKeys.repos });
		},
	});
}

/**
 * Stopping a sync that has already finished is not an error, so this has no
 * failure path of its own: the server answers `cancelled: false` and the
 * repository refetch shows whatever actually happened.
 */
export function useCancelSync() {
	const client = useQueryClient();
	return useMutation<SyncCancelled, Error, string>({
		mutationFn: (repoId) =>
			post(SyncCancelledSchema, `/api/repos/${repoId}/sync/cancel`, {}),
		onSuccess: () => {
			void client.invalidateQueries({ queryKey: queryKeys.repos });
		},
	});
}

export function useAnalyse() {
	const client = useQueryClient();
	return useMutation<QueueResult, Error, string[]>({
		mutationFn: (entryIds) =>
			post(QueueResultSchema, "/api/entries/analyse", { entry_ids: entryIds }),
		onSuccess: () => {
			void client.invalidateQueries({ queryKey: ["entries"] });
			void client.invalidateQueries({ queryKey: ["entry"] });
			void client.invalidateQueries({ queryKey: queryKeys.repos });
		},
	});
}

/**
 * Stopping an analysis that has already finished is not an error: the entry
 * comes back `skipped` and the refetch shows whatever actually happened.
 *
 * Invalidating immediately would race a run still unwinding inside its
 * handler, so a refetch can briefly still show the entry busy. The entry event
 * that follows the revert is what settles it.
 */
export function useCancelAnalysis() {
	const client = useQueryClient();
	return useMutation<CancelResult, Error, string[]>({
		mutationFn: (entryIds) =>
			post(CancelResultSchema, "/api/entries/analyse/cancel", {
				entry_ids: entryIds,
			}),
		onSuccess: () => {
			void client.invalidateQueries({ queryKey: ["entries"] });
			void client.invalidateQueries({ queryKey: ["entry"] });
			void client.invalidateQueries({ queryKey: queryKeys.repos });
		},
	});
}

/** Stops everything this repository has queued or running, in one press. */
export function useCancelRepoAnalysis() {
	const client = useQueryClient();
	return useMutation<RepoAnalyseCancelled, Error, string>({
		mutationFn: (repoId) =>
			post(
				RepoAnalyseCancelledSchema,
				`/api/repos/${repoId}/analyse/cancel`,
				{},
			),
		onSuccess: () => {
			void client.invalidateQueries({ queryKey: ["entries"] });
			void client.invalidateQueries({ queryKey: ["entry"] });
			void client.invalidateQueries({ queryKey: queryKeys.repos });
		},
	});
}

export function useSetRuleStatus() {
	const client = useQueryClient();
	return useMutation<
		RuleSummary[],
		Error,
		{ ruleIds: string[]; status: "verified" | "abandoned" }
	>({
		mutationFn: ({ ruleIds, status }) =>
			post(z.array(RuleSummarySchema), "/api/rules/status", {
				rule_ids: ruleIds,
				status,
			}),
		onSuccess: () => {
			void client.invalidateQueries({ queryKey: ["rules"] });
			void client.invalidateQueries({ queryKey: ["rule"] });
			void client.invalidateQueries({ queryKey: queryKeys.repos });
		},
	});
}

export function usePlanPromotion() {
	return useMutation<PromotionPlanView, Error, string[]>({
		mutationFn: (ruleIds) =>
			post(PromotionPlanSchema, "/api/promotions/plan", { rule_ids: ruleIds }),
	});
}

export function useCreatePromotion() {
	const client = useQueryClient();
	return useMutation<PromotionSummary, Error, string[]>({
		mutationFn: (ruleIds) =>
			post(PromotionSummarySchema, "/api/promotions", { rule_ids: ruleIds }),
		onSuccess: () => {
			void client.invalidateQueries({ queryKey: ["rules"] });
			void client.invalidateQueries({ queryKey: ["rule"] });
			void client.invalidateQueries({ queryKey: ["promotions"] });
			void client.invalidateQueries({ queryKey: queryKeys.repos });
		},
	});
}

export function useRefreshPromotions() {
	const client = useQueryClient();
	return useMutation<RefreshSummaryView, Error, string | undefined>({
		mutationFn: (repoId) =>
			post(
				RefreshSummarySchema,
				"/api/promotions/refresh",
				repoId ? { repo_id: repoId } : {},
			),
		onSuccess: () => {
			void client.invalidateQueries({ queryKey: ["promotions"] });
			void client.invalidateQueries({ queryKey: ["rules"] });
			void client.invalidateQueries({ queryKey: ["rule"] });
			void client.invalidateQueries({ queryKey: queryKeys.repos });
		},
	});
}

/**
 * Reads config from disk on every fetch, so a file edited in a text editor
 * shows up here.
 *
 * `staleTime: 0` for the same reason, and the panel refetches on mount: the
 * hash in this response is the precondition every write carries, and a stale
 * one is a 409 the user did nothing to deserve.
 */
export function useConfig(): UseQueryResult<ConfigResponse> {
	return useQuery({
		queryKey: queryKeys.config,
		queryFn: () => request(ConfigResponseSchema, "/api/config"),
		staleTime: 0,
	});
}

/**
 * Every settings write returns the whole config afresh, so each of these seeds
 * the cache from its own response rather than invalidating and refetching. A
 * refetch would leave a window in which the panel holds the hash it just
 * superseded.
 *
 * `repos` is invalidated alongside, because adding, removing, or renaming a
 * repository changes the sidebar.
 */
function useConfigMutation<V>(send: (variables: V) => Promise<ConfigResponse>) {
	const client = useQueryClient();
	return useMutation<ConfigResponse, Error, V>({
		mutationFn: send,
		onSuccess: (response) => {
			client.setQueryData(queryKeys.config, response);
			void client.invalidateQueries({ queryKey: queryKeys.repos });
		},
	});
}

export function useSaveConfig() {
	return useConfigMutation<{ config: ConfigDocument; hash: string }>((body) =>
		request(ConfigResponseSchema, "/api/config", {
			method: "PUT",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
		}),
	);
}

export function useRenameRepo() {
	return useConfigMutation<{ repoId: string; name: string; hash: string }>(
		({ repoId, name, hash }) =>
			post(ConfigResponseSchema, `/api/repos/${repoId}/rename`, { name, hash }),
	);
}

export function useRenameHost() {
	return useConfigMutation<{ hostId: string; name: string; hash: string }>(
		({ hostId, name, hash }) =>
			post(ConfigResponseSchema, `/api/hosts/${hostId}/rename`, { name, hash }),
	);
}

/** Permanent, and only ever offered for something already archived. */
export function useDeleteRepo() {
	return useConfigMutation<string>((repoId) =>
		request(ConfigResponseSchema, `/api/repos/${repoId}`, { method: "DELETE" }),
	);
}

export function useDeleteHost() {
	return useConfigMutation<string>((hostId) =>
		request(ConfigResponseSchema, `/api/hosts/${hostId}`, { method: "DELETE" }),
	);
}

/** A rejected token is a result, not a failed request, so this has no error path of its own. */
export function useTestHost() {
	return useMutation<HostTestResult, Error, string>({
		mutationFn: (hostId) =>
			post(HostTestResultSchema, `/api/hosts/${hostId}/test`, {}),
	});
}
