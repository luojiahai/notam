import type { QueryClient } from "@tanstack/react-query";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import type { ServerEvent } from "../../src/shared/api.ts";
import { useServerEvents } from "./api/events.ts";
import {
	queryKeys,
	useAnalyse,
	useCancelAnalysis,
	useCancelRepoAnalysis,
	useCancelSync,
	useMeta,
	useRefreshPromotions,
	useRepos,
	useSync,
} from "./api/hooks.ts";
import { EntriesTab } from "./components/EntriesTab.tsx";
import { EntryPanel } from "./components/EntryPanel.tsx";
import { PromotionsTab } from "./components/PromotionsTab.tsx";
import { RepoBar } from "./components/RepoBar.tsx";
import { RulePanel } from "./components/RulePanel.tsx";
import { RulesTab } from "./components/RulesTab.tsx";
import { SettingsModal } from "./components/SettingsModal.tsx";
import { Shell } from "./components/Shell.tsx";
import { Sidebar } from "./components/Sidebar.tsx";
import { type Tab, Tabs, tabDomId } from "./components/Tabs.tsx";

type WorkspaceTab = "entries" | "rules" | "promotions";

const TABS: readonly Tab<WorkspaceTab>[] = [
	{ id: "entries", label: "Entries" },
	{ id: "rules", label: "Rules" },
	{ id: "promotions", label: "Promotions" },
];

/** Shared by every tab and the panel they control, so the pair can be wired. */
const WORKSPACE_PANEL_ID = "workspace";

export type PanelTarget = { kind: "entry" | "rule"; id: string } | null;

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
 * single detail key: every open panel of that kind needs to refetch, not just
 * one.
 *
 * - `"rules"` (any rule's status changed: verify/abandon, new rules from
 *   analysis, promotion creation, rules returned to draft on refresh) strands
 *   both an open rule panel (`["rule"]`) and an open entry panel, whose
 *   `EntryDetailSchema.rules` embeds each rule's status (`["entry"]`).
 * - `"sync"` can update an existing entry's title/body/labels
 *   (`upsertEntry` on a repeat sync), so it strands an open entry panel too.
 */
export function invalidationsFor(event: ServerEvent): (readonly unknown[])[] {
	switch (event.type) {
		case "entry":
			return [["entries"], queryKeys.entry(event.entry_id), queryKeys.repos];
		case "rules":
			return [["rules"], ["rule"], ["entries"], ["entry"], queryKeys.repos];
		case "sync":
			// `started` refetches the repository list alone: it carries the new
			// sync state, and no pull request has been ingested yet, so asking
			// for entries would be a round trip for data that cannot have
			// changed. `progress` refreshes the rows and the counts but leaves
			// the panels alone — a throttled tick must not refetch an open
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
 * Applies one server event to the cache: sync progress updates local state
 * directly, everything else invalidates the query keys `invalidationsFor`
 * names for it.
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
	setProgress: (repoId: string, progress: SyncProgress | null) => void,
): void {
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
	const [tab, setTab] = useState<WorkspaceTab>("entries");
	const [panel, setPanel] = useState<PanelTarget>(null);
	const [settingsOpen, setSettingsOpen] = useState(false);
	const [progress, setProgress] = useState<Record<string, SyncProgress>>({});

	// Select the first repository as soon as one is known, and never fight the
	// user's own choice afterwards.
	useEffect(() => {
		if (repoId === null && repos.data && repos.data.length > 0) {
			setRepoId(repos.data[0]?.id ?? null);
		}
	}, [repoId, repos.data]);

	const sync = useSync();
	const cancelSync = useCancelSync();
	// App's own instance, and only for the pass on mount below: the button that
	// refreshes on demand lives in the promotions tab and owns its own.
	const refresh = useRefreshPromotions();
	const analyse = useAnalyse();
	// Owned here rather than in the tab, so one press has one mutation: the
	// table, the panel and the sweep share these, and a stop that never
	// reached the server surfaces in the banner below whichever raised it.
	const cancelAnalysis = useCancelAnalysis();
	const cancelRepoAnalysis = useCancelRepoAnalysis();

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
			(event) => applyServerEvent(client, event, recordProgress),
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
	// Distinct texts only, because two of these can fail against the same
	// unreachable server and say so in the same words, and the same sentence
	// twice is noise rather than a second warning.
	const lastSync = repo?.sync.last ?? null;
	const warnings = [
		...new Set([
			...(meta.data?.warnings ?? []),
			...(lastSync?.outcome === "failed" && lastSync.error
				? [lastSync.error]
				: []),
			...(sync.error ? [sync.error.message] : []),
			...(cancelSync.error ? [cancelSync.error.message] : []),
			...(cancelAnalysis.error ? [cancelAnalysis.error.message] : []),
			...(cancelRepoAnalysis.error ? [cancelRepoAnalysis.error.message] : []),
		]),
	];

	return (
		<Shell
			version={meta.data?.version ?? ""}
			warnings={warnings}
			onOpenSettings={() => setSettingsOpen(true)}
			sidebar={
				<Sidebar
					repos={repos.data ?? []}
					selectedRepoId={repoId}
					onSelectRepo={(id) => {
						setRepoId(id);
						setPanel(null);
					}}
				/>
			}
		>
			{repo && (
				<RepoBar
					repoName={repo.name}
					repoUrl={repo.url}
					syncedAt={repo.sync_watermark}
					sync={repo.sync}
					progress={progress[repo.id] ?? null}
					onSync={() => sync.mutate(repo.id)}
					onCancelSync={() => cancelSync.mutate(repo.id)}
				/>
			)}
			<Tabs
				tabs={TABS}
				active={tab}
				onChange={setTab}
				panelId={WORKSPACE_PANEL_ID}
			/>
			{/*
				One panel for the whole run rather than three, only one of which is
				ever mounted: `aria-labelledby` names whichever tab is live, which is
				what tells a screen reader what it just landed in.
			*/}
			<div
				className="workspace"
				id={WORKSPACE_PANEL_ID}
				role="tabpanel"
				aria-labelledby={tabDomId(tab)}
				// biome-ignore lint/a11y/noNoninteractiveTabindex: a tabpanel is this rule's documented exception. With no repository selected, or a query still in flight, this panel holds nothing focusable — and arrowing to a tab whose panel cannot then be reached is the failure the tabindex prevents.
				tabIndex={0}
			>
				{repoId === null ? (
					<div className="table-wrap">
						{/*
						Two different nothings. With no repositories configured at all
						there is nothing to pick, and the answer is the settings
						window — which is what replaces a separate first-run wizard.
					*/}
						{repos.data?.length === 0 ? (
							<div className="state">
								<p className="state-title">No repositories yet</p>
								<p className="state-hint">
									Add one in Settings, then sync it to collect the agreements
									buried in its merged pull requests.
								</p>
								{/*
								Named for the job rather than the destination: this is the
								first-run path, and "settings" undersells what it does. It
								also keeps this button's accessible name clear of the
								header's own control, which is named "Settings" and nothing
								else — two controls whose names contain one another are two
								controls a screen reader cannot tell apart.
							*/}
								<button
									type="button"
									className="btn-primary"
									onClick={() => setSettingsOpen(true)}
								>
									Configure a repository
								</button>
							</div>
						) : (
							<div className="state">
								<p className="state-title">No repository selected</p>
								<p className="state-hint">
									Pick one from the sidebar to see its entries, rules, and
									promotions.
								</p>
							</div>
						)}
					</div>
				) : tab === "entries" ? (
					// Keyed on the repository: without it React keeps the tab's state
					// across a switch, and a selection made in one repository would
					// still be sitting there — and still actionable — in the next.
					<EntriesTab
						key={repoId}
						repoId={repoId}
						onOpenEntry={(id) => setPanel({ kind: "entry", id })}
						onCancel={(ids) => cancelAnalysis.mutate(ids)}
						onCancelAll={() => cancelRepoAnalysis.mutate(repoId)}
					/>
				) : tab === "rules" ? (
					<RulesTab
						key={repoId}
						repoId={repoId}
						onOpenRule={(id) => setPanel({ kind: "rule", id })}
						// A created pull request is only ever shown on the promotions
						// tab, so making one moves the user there. Left where they were,
						// the one thing the screen would not show is the thing the dialog
						// just made.
						onPromoted={() => setTab("promotions")}
					/>
				) : (
					<PromotionsTab key={repoId} repoId={repoId} />
				)}
			</div>
			{panel?.kind === "entry" && (
				<EntryPanel
					entryId={panel.id}
					onClose={() => setPanel(null)}
					onReanalyse={(entryId) => analyse.mutate([entryId])}
					onCancel={(entryId) => cancelAnalysis.mutate([entryId])}
					onOpenRule={(ruleId) => setPanel({ kind: "rule", id: ruleId })}
				/>
			)}
			{panel?.kind === "rule" && (
				<RulePanel ruleId={panel.id} onClose={() => setPanel(null)} />
			)}
			{settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
		</Shell>
	);
}
