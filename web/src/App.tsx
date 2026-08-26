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
import { AdoptedStage } from "./components/AdoptedStage.tsx";
import { EntriesTab } from "./components/EntriesTab.tsx";
import { EntryDrawer } from "./components/EntryDrawer.tsx";
import type { Stage } from "./components/Pipeline.tsx";
import { Pipeline, stageTabId } from "./components/Pipeline.tsx";
import { RepoBar } from "./components/RepoBar.tsx";
import { ReviewStage } from "./components/ReviewStage.tsx";
import { RuleDrawer } from "./components/RuleDrawer.tsx";
import { RulesStage } from "./components/RulesStage.tsx";
import { SettingsModal } from "./components/SettingsModal.tsx";
import { Shell } from "./components/Shell.tsx";
import { Sidebar } from "./components/Sidebar.tsx";

export type DrawerTarget = { kind: "entry" | "rule"; id: string } | null;

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
	// Sources is where a repository with nothing in it starts, and where the
	// work starts on any given morning: everything downstream is fed from it.
	const [stage, setStage] = useState<Stage>("sources");
	const [drawer, setDrawer] = useState<DrawerTarget>(null);
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
	// table, the drawer and the sweep share these, and a stop that never
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
	const lastSync = repo?.sync.last ?? null;
	const warnings = [
		...(meta.data?.warnings ?? []),
		...(lastSync?.outcome === "failed" && lastSync.error
			? [lastSync.error]
			: []),
		...(sync.error ? [sync.error.message] : []),
		...(cancelSync.error ? [cancelSync.error.message] : []),
		...(cancelAnalysis.error ? [cancelAnalysis.error.message] : []),
		...(cancelRepoAnalysis.error ? [cancelRepoAnalysis.error.message] : []),
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
						setDrawer(null);
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
			{repo && (
				<Pipeline
					repo={repo}
					stage={stage}
					onStageChange={(next) => {
						setStage(next);
						// A drawer belongs to the stage it was opened from. Left
						// open across a move it covers the screen the user just
						// asked to see, over a row that stage may not even list.
						setDrawer(null);
					}}
				/>
			)}
			{/*
				The one panel the pipeline drives. It is labelled by whichever tab
				is live rather than carrying a name of its own, so the region a
				screen reader lands in after the tab list announces itself as the
				stage the reader just chose.
			*/}
			<div
				className="panel"
				role="tabpanel"
				aria-labelledby={repo ? stageTabId(stage) : undefined}
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
				) : stage === "sources" ? (
					// Keyed on the repository: without it React keeps the stage's state
					// across a switch, and a selection made in one repository would
					// still be sitting there — and still actionable — in the next.
					<EntriesTab
						key={repoId}
						repoId={repoId}
						onOpenEntry={(id) => setDrawer({ kind: "entry", id })}
						onCancel={(ids) => cancelAnalysis.mutate(ids)}
						onCancelAll={() => cancelRepoAnalysis.mutate(repoId)}
					/>
				) : stage === "draft" || stage === "aside" ? (
					// Keyed on the stage as well as the repository: the two stages share
					// a component, and without it a search typed over the drafts would
					// still be narrowing the abandoned list after the move.
					<RulesStage
						key={`${repoId}:${stage}`}
						repoId={repoId}
						status={stage === "draft" ? "draft" : "abandoned"}
						onOpenRule={(id) => setDrawer({ kind: "rule", id })}
						// A rule that has just been promoted is no longer a draft, so
						// the stage the user is standing on is precisely the one place
						// the thing they just made does not appear. Move them to it.
						onPromoted={() => setStage("review")}
					/>
				) : stage === "review" ? (
					<ReviewStage
						key={repoId}
						repoId={repoId}
						onOpenRule={(id) => setDrawer({ kind: "rule", id })}
					/>
				) : (
					<AdoptedStage
						key={repoId}
						repoId={repoId}
						repoName={repo?.name ?? ""}
						onOpenRule={(id) => setDrawer({ kind: "rule", id })}
					/>
				)}
			</div>
			{drawer?.kind === "entry" && (
				<EntryDrawer
					entryId={drawer.id}
					onClose={() => setDrawer(null)}
					onReanalyse={(entryId) => analyse.mutate([entryId])}
					onCancel={(entryId) => cancelAnalysis.mutate([entryId])}
					onOpenRule={(ruleId) => setDrawer({ kind: "rule", id: ruleId })}
				/>
			)}
			{drawer?.kind === "rule" && (
				<RuleDrawer ruleId={drawer.id} onClose={() => setDrawer(null)} />
			)}
			{settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
		</Shell>
	);
}
