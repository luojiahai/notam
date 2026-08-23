import type { QueryClient } from "@tanstack/react-query";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import type { ServerEvent } from "../../src/shared/api.ts";
import { useServerEvents } from "./api/events.ts";
import {
	queryKeys,
	useAnalyse,
	useMeta,
	usePromotions,
	useRefreshPromotions,
	useRepos,
	useSync,
} from "./api/hooks.ts";
import { EntriesTab } from "./components/EntriesTab.tsx";
import { EntryDrawer } from "./components/EntryDrawer.tsx";
import { Shell } from "./components/Shell.tsx";
import { Sidebar } from "./components/Sidebar.tsx";

export type DrawerTarget = { kind: "entry" | "rule"; id: string } | null;
export type BatchState = { queued: number; running: number };

/**
 * The query-key families a given server event strands if left uninvalidated.
 * Pure and exported so the mapping — the thing that grew three gaps across two
 * rounds of review — is tested directly rather than only through a live
 * connection.
 *
 * `"rules"` and `"sync"` events carry no rule/entry id, so they invalidate the
 * bare `["rule"]` / `["entry"]` prefixes (the same partial-match pattern
 * `useSetRuleStatus` and `useCreatePromotion` use in hooks.ts) rather than a
 * single detail key: every open drawer of that kind needs to refetch, not just
 * one.
 *
 * - `"rules"` (any rule's status changed: verify/abandon, new rules from
 *   analysis, promotion creation, rules returned to draft on refresh) strands
 *   both an open rule drawer (`["rule"]`) and an open entry drawer, whose
 *   `EntryDetailSchema.rules` embeds each rule's status (`["entry"]`).
 * - `"sync"` can update an existing entry's title/body/labels
 *   (`upsertEntry` on a repeat sync), so it strands an open entry drawer too.
 */
export function invalidationsFor(event: ServerEvent): (readonly unknown[])[] {
	switch (event.type) {
		case "batch":
			return [];
		case "entry":
			return [["entries"], queryKeys.entry(event.entry_id), queryKeys.repos];
		case "rules":
			return [["rules"], ["rule"], ["entries"], ["entry"], queryKeys.repos];
		case "sync":
			return [["entries"], ["entry"], queryKeys.repos];
		case "promotion":
			return [["promotions"], ["rules"], queryKeys.repos];
		default:
			return [];
	}
}

/**
 * Applies one server event to the cache: batch progress updates local state
 * directly, everything else invalidates the query keys `invalidationsFor`
 * names for it.
 */
export function applyServerEvent(
	client: QueryClient,
	event: ServerEvent,
	setBatch: (batch: BatchState) => void,
): void {
	if (event.type === "batch") {
		setBatch({ queued: event.queued, running: event.running });
		return;
	}
	for (const queryKey of invalidationsFor(event)) {
		void client.invalidateQueries({ queryKey });
	}
}

export function App() {
	const client = useQueryClient();
	const meta = useMeta();
	const repos = useRepos();
	const [repoId, setRepoId] = useState<string | null>(null);
	const [tab, setTab] = useState<"entries" | "rules">("entries");
	const [drawer, setDrawer] = useState<DrawerTarget>(null);
	const [batch, setBatch] = useState<BatchState>({ queued: 0, running: 0 });

	// Select the first repository as soon as one is known, and never fight the
	// user's own choice afterwards.
	useEffect(() => {
		if (repoId === null && repos.data && repos.data.length > 0) {
			setRepoId(repos.data[0]?.id ?? null);
		}
	}, [repoId, repos.data]);

	const promotions = usePromotions(repoId);
	const sync = useSync();
	const refresh = useRefreshPromotions();
	const analyse = useAnalyse();

	useServerEvents(
		useCallback((event) => applyServerEvent(client, event, setBatch), [client]),
	);

	// Spec section 7: the status refresh runs on app open as well as on the
	// button. The server does its own pass at boot; this covers a tab opened
	// hours later against a long-running process.
	// biome-ignore lint/correctness/useExhaustiveDependencies: intentionally once per mount, not on every `refresh` identity change.
	useEffect(() => {
		refresh.mutate(undefined);
	}, []);

	const repo = repos.data?.find((candidate) => candidate.id === repoId) ?? null;

	return (
		<Shell
			repoName={repo?.name ?? null}
			version={meta.data?.version ?? ""}
			warnings={meta.data?.warnings ?? []}
			onSync={() => {
				if (repoId) sync.mutate(repoId);
			}}
			syncing={sync.isPending}
			sidebar={
				<Sidebar
					repos={repos.data ?? []}
					promotions={promotions.data ?? []}
					selectedRepoId={repoId}
					onSelectRepo={(id) => {
						setRepoId(id);
						setDrawer(null);
					}}
					onRefreshPromotions={() => refresh.mutate(repoId ?? undefined)}
					refreshing={refresh.isPending}
				/>
			}
		>
			<div className="tabs" role="tablist">
				<button
					type="button"
					role="tab"
					aria-selected={tab === "entries"}
					onClick={() => setTab("entries")}
				>
					Entries
				</button>
				<button
					type="button"
					role="tab"
					aria-selected={tab === "rules"}
					onClick={() => setTab("rules")}
				>
					Rules
				</button>
			</div>
			{repoId === null ? (
				<div className="table-wrap">
					<p className="secondary">Select a repository.</p>
				</div>
			) : tab === "entries" ? (
				<EntriesTab
					repoId={repoId}
					batch={batch}
					onOpenEntry={(id) => setDrawer({ kind: "entry", id })}
				/>
			) : (
				<div className="table-wrap">
					<p className="secondary">Rules for {repo?.name}</p>
				</div>
			)}
			{drawer?.kind === "entry" && (
				<EntryDrawer
					entryId={drawer.id}
					onClose={() => setDrawer(null)}
					onReanalyse={(entryId) => analyse.mutate([entryId])}
					onOpenRule={(ruleId) => setDrawer({ kind: "rule", id: ruleId })}
				/>
			)}
		</Shell>
	);
}
