import {
	type UseQueryResult,
	useMutation,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { z } from "zod";
import {
	type AnalysisState,
	type EntriesResponse,
	EntriesResponseSchema,
	type EntryDetail,
	EntryDetailSchema,
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
	type RepoSummary,
	RepoSummarySchema,
	type RuleDetail,
	RuleDetailSchema,
	type RuleStatus,
	RuleSummarySchema,
	type RulesResponse,
	RulesResponseSchema,
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
	rules: (repoId: string, status: string, q: string, sort: string) =>
		["rules", repoId, status, q, sort] as const,
	rule: (ruleId: string) => ["rule", ruleId] as const,
	promotions: (repoId: string) => ["promotions", repoId] as const,
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
	sort: "created" | "directive",
): UseQueryResult<RulesResponse> {
	return useQuery({
		enabled: repoId !== null,
		queryKey: queryKeys.rules(repoId ?? "", status, q, sort),
		queryFn: () =>
			request(
				RulesResponseSchema,
				`/api/repos/${repoId}/rules${query({ status, q, sort })}`,
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
 * `["rule", id]`: without the second call an open drawer keeps rendering the
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

export function useAnalyseUnanalysed() {
	const client = useQueryClient();
	return useMutation<QueueResult, Error, string>({
		mutationFn: (repoId) =>
			post(QueueResultSchema, `/api/repos/${repoId}/analyse-unanalysed`, {}),
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
		unknown,
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
