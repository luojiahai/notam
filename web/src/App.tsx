import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { useServerEvents } from "./api/events.ts";
import {
	queryKeys,
	useMeta,
	usePromotions,
	useRefreshPromotions,
	useRepos,
	useSync,
} from "./api/hooks.ts";
import { Shell } from "./components/Shell.tsx";
import { Sidebar } from "./components/Sidebar.tsx";

export type DrawerTarget = { kind: "entry" | "rule"; id: string } | null;
export type BatchState = { queued: number; running: number };

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

	useServerEvents(
		useCallback(
			(event) => {
				switch (event.type) {
					case "batch":
						setBatch({ queued: event.queued, running: event.running });
						break;
					case "entry":
						void client.invalidateQueries({ queryKey: ["entries"] });
						void client.invalidateQueries({
							queryKey: queryKeys.entry(event.entry_id),
						});
						void client.invalidateQueries({ queryKey: queryKeys.repos });
						break;
					case "rules":
						void client.invalidateQueries({ queryKey: ["rules"] });
						void client.invalidateQueries({ queryKey: ["entries"] });
						void client.invalidateQueries({ queryKey: queryKeys.repos });
						break;
					case "sync":
						void client.invalidateQueries({ queryKey: ["entries"] });
						void client.invalidateQueries({ queryKey: queryKeys.repos });
						break;
					case "promotion":
						void client.invalidateQueries({ queryKey: ["promotions"] });
						void client.invalidateQueries({ queryKey: ["rules"] });
						void client.invalidateQueries({ queryKey: queryKeys.repos });
						break;
					default:
						break;
				}
			},
			[client],
		),
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
			<div className="table-wrap">
				{repoId === null ? (
					<p className="secondary">Select a repository.</p>
				) : (
					<p className="secondary">
						{tab === "entries" ? "Entries" : "Rules"} for {repo?.name} —{" "}
						{batch.running} running, {batch.queued} queued
						{drawer ? ` — drawer: ${drawer.kind} ${drawer.id}` : ""}
					</p>
				)}
			</div>
		</Shell>
	);
}
