import type { QueryClient } from "@tanstack/react-query";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import type { ServerEvent } from "../../src/shared/api.ts";
import { useServerEvents } from "./api/events.ts";
import {
	queryKeys,
	useAnalyse,
	useCancelSync,
	useMeta,
	usePromotions,
	useRefreshPromotions,
	useRepos,
	useSync,
} from "./api/hooks.ts";
import { EntriesTab } from "./components/EntriesTab.tsx";
import { EntryDrawer } from "./components/EntryDrawer.tsx";
import { RepoBar } from "./components/RepoBar.tsx";
import { RuleDrawer } from "./components/RuleDrawer.tsx";
import { RulesTab } from "./components/RulesTab.tsx";
import { Shell } from "./components/Shell.tsx";
import { Sidebar } from "./components/Sidebar.tsx";

export type DrawerTarget = { kind: "entry" | "rule"; id: string } | null;
export type BatchState = { queued: number; running: number };

/** The running totals of a sync still walking pages, as the wire reports them. */
export type SyncProgress = {
	scanned: number;
	created: number;
	updated: number;
	skipped: number;
};

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
			// `started` refetches the repository list alone: it carries the new
			// sync state, and no pull request has been ingested yet, so asking
			// for entries would be a round trip for data that cannot have
			// changed. `progress` refreshes the rows and the counts but leaves
			// the drawers alone — a throttled tick must not refetch an open
			// entry twice a second, and the terminal event reconciles them.
			if (event.phase === "started") return [queryKeys.repos];
			if (event.phase === "progress") return [["entries"], queryKeys.repos];
			return [["entries"], ["entry"], queryKeys.repos];
		case "promotion":
			return [["promotions"], ["rules"], queryKeys.repos];
		default:
			return [];
	}
}

/**
 * Applies one server event to the cache: queue depth and sync progress update
 * local state directly, everything else invalidates the query keys
 * `invalidationsFor` names for it.
 *
 * Sync progress is the one payload that is not a cache hint. It is a live
 * tally with no query behind it, so it is held in App state; every phase but
 * `progress` clears it, because a sync that started, ended, or was stopped has
 * no totals worth showing.
 *
 * How a sync *ended* is deliberately not held here: it lives on the repository
 * summary, so it survives a reload and is cleared only by that repository's
 * own next sync rather than by any other repository finishing.
 */
export function applyServerEvent(
	client: QueryClient,
	event: ServerEvent,
	setBatch: (batch: BatchState) => void,
	setProgress: (repoId: string, progress: SyncProgress | null) => void,
): void {
	if (event.type === "batch") {
		setBatch({ queued: event.queued, running: event.running });
		return;
	}
	if (event.type === "sync") {
		setProgress(
			event.repo_id,
			event.phase === "progress"
				? {
						scanned: event.scanned,
						created: event.created,
						updated: event.updated,
						skipped: event.skipped,
					}
				: null,
		);
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
	const [progress, setProgress] = useState<Record<string, SyncProgress>>({});

	// Select the first repository as soon as one is known, and never fight the
	// user's own choice afterwards.
	useEffect(() => {
		if (repoId === null && repos.data && repos.data.length > 0) {
			setRepoId(repos.data[0]?.id ?? null);
		}
	}, [repoId, repos.data]);

	const promotions = usePromotions(repoId);
	const sync = useSync();
	const cancelSync = useCancelSync();
	const refresh = useRefreshPromotions();
	const analyse = useAnalyse();

	const recordProgress = useCallback(
		(id: string, totals: SyncProgress | null) => {
			setProgress((current) => {
				if (totals === null) {
					if (!(id in current)) return current;
					const { [id]: _cleared, ...rest } = current;
					return rest;
				}
				return { ...current, [id]: totals };
			});
		},
		[],
	);

	useServerEvents(
		useCallback(
			(event) => applyServerEvent(client, event, setBatch, recordProgress),
			[client, recordProgress],
		),
	);

	// The status refresh runs on app open as well as on the
	// button. The server does its own pass at boot; this covers a tab opened
	// hours later against a long-running process.
	// biome-ignore lint/correctness/useExhaustiveDependencies: intentionally once per mount, not on every `refresh` identity change.
	useEffect(() => {
		refresh.mutate(undefined);
	}, []);

	const repo = repos.data?.find((candidate) => candidate.id === repoId) ?? null;

	// Server text, unrewritten: the boot warnings, then how this repository's
	// last sync failed, then a sync or stop request that never even landed.
	// The failure comes from the repository summary rather than from a
	// transient event, so it survives a reload and is cleared by this
	// repository's own next sync rather than by any other repository's.
	const lastSync = repo?.sync.last ?? null;
	const warnings = [
		...(meta.data?.warnings ?? []),
		...(lastSync?.outcome === "failed" && lastSync.error
			? [lastSync.error]
			: []),
		...(sync.error ? [sync.error.message] : []),
		...(cancelSync.error ? [cancelSync.error.message] : []),
	];

	return (
		<Shell
			version={meta.data?.version ?? ""}
			warnings={warnings}
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
					refreshError={refresh.error?.message ?? null}
				/>
			}
		>
			{repo && (
				<RepoBar
					repoName={repo.name}
					syncedAt={repo.sync_watermark}
					sync={repo.sync}
					progress={progress[repo.id] ?? null}
					onSync={() => sync.mutate(repo.id)}
					onCancelSync={() => cancelSync.mutate(repo.id)}
				/>
			)}
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
					<div className="state">
						<p className="state-title">No repository selected</p>
						<p className="state-hint">
							Pick one from the sidebar to see its entries and rules.
						</p>
					</div>
				</div>
			) : tab === "entries" ? (
				// Keyed on the repository: without it React keeps the tab's state
				// across a switch, and a selection made in one repository would
				// still be sitting there — and still actionable — in the next.
				<EntriesTab
					key={repoId}
					repoId={repoId}
					batch={batch}
					onOpenEntry={(id) => setDrawer({ kind: "entry", id })}
				/>
			) : (
				<RulesTab
					key={repoId}
					repoId={repoId}
					onOpenRule={(id) => setDrawer({ kind: "rule", id })}
				/>
			)}
			{drawer?.kind === "entry" && (
				<EntryDrawer
					entryId={drawer.id}
					onClose={() => setDrawer(null)}
					onReanalyse={(entryId) => analyse.mutate([entryId])}
					onOpenRule={(ruleId) => setDrawer({ kind: "rule", id: ruleId })}
				/>
			)}
			{drawer?.kind === "rule" && (
				<RuleDrawer ruleId={drawer.id} onClose={() => setDrawer(null)} />
			)}
		</Shell>
	);
}
