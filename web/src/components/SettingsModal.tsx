import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type {
	ConfigDocument,
	ConfigResponse,
	HostTestResult,
} from "../../../src/shared/api.ts";
import {
	useConfig,
	useDeleteHost,
	useDeleteRepo,
	useRenameHost,
	useRenameRepo,
	useSaveConfig,
	useTestHost,
} from "../api/hooks.ts";
import {
	addHost,
	blankHost,
	isDirty,
	restoreHost,
	restoreRepo,
} from "../lib/config.ts";
import { useDismissOnEscape } from "../lib/dismiss.ts";
import { useModalFocus } from "../lib/modal.ts";
import {
	ArchivedPane,
	costLabel,
	HostPane,
	ProcessPane,
	RepoPane,
} from "./SettingsPanes.tsx";
import type { Selection } from "./SettingsRail.tsx";
import { resolveSelection, SettingsRail } from "./SettingsRail.tsx";

export type SettingsFormProps = {
	response: ConfigResponse;
	draft: ConfigDocument;
	saved: ConfigDocument;
	onChange: (next: ConfigDocument) => void;
	onSave: () => void;
	onRenameRepo: (repoId: string, name: string) => void;
	onRenameHost: (hostId: string, name: string) => void;
	onDeleteRepo: (repoId: string) => void;
	onDeleteHost: (hostId: string) => void;
	onTest: (hostId: string) => void;
	testResults: Record<string, HostTestResult>;
	busy: boolean;
	saving: boolean;
	testing: boolean;
	/** Server text, unrewritten: a 409 says the file moved, a 400 names the field. */
	error: Error | null;
};

/** Everything below the window's title bar, with no data fetching of its own. */
export function SettingsForm({
	response,
	draft,
	saved,
	onChange,
	onSave,
	onRenameRepo,
	onRenameHost,
	onDeleteRepo,
	onDeleteHost,
	onTest,
	testResults,
	busy,
	saving,
	testing,
	error,
}: SettingsFormProps) {
	const dirty = isDirty(draft, saved);
	const [selection, setSelection] = useState<Selection | null>(null);
	const current = resolveSelection(
		selection,
		draft,
		response.status.archived_repos,
		response.status.archived_hosts,
	);

	const archivedRepo =
		current.kind === "archivedRepo"
			? (response.status.archived_repos.find(
					(repo) => repo.id === current.id,
				) ?? null)
			: null;
	const archivedHost =
		current.kind === "archivedHost"
			? (response.status.archived_hosts.find(
					(host) => host.id === current.id,
				) ?? null)
			: null;

	return (
		<>
			{/*
				Above the split rather than in a pane, because it is true of the whole
				window: whichever entity is selected, Save rewrites this one file.
			*/}
			<div className="settings-note">
				<span className="secondary mono">{response.path}</span>
				<span className="secondary">
					NOTAM owns this file. Saving rewrites it whole, so comments you add do
					not survive. Editing it in a text editor works too — this window reads
					it fresh every time it opens.
				</span>
			</div>

			{error !== null && (
				<div className="settings-error">
					<p className="state-title">Not saved</p>
					<p className="state-hint">{error.message}</p>
				</div>
			)}

			{draft.hosts.length === 0 &&
			response.status.archived_hosts.length === 0 &&
			response.status.archived_repos.length === 0 ? (
				/*
					With nothing configured there is nothing to navigate, so the split
					collapses: a rail listing only its own "Add a host" button would be
					chrome around a single control.
				*/
				<div className="settings-empty">
					<div className="state">
						<p className="state-title">No hosts configured</p>
						<p className="state-hint">
							Add the host your repositories live on, then the repositories
							themselves.
						</p>
						<button
							type="button"
							className="btn-primary"
							onClick={() => {
								onChange(addHost(draft, blankHost()));
								setSelection({ kind: "host", index: 0 });
							}}
						>
							Add a host
						</button>
					</div>
				</div>
			) : (
				<div className="settings-split">
					<SettingsRail
						draft={draft}
						response={response}
						selection={current}
						onSelect={setSelection}
						onChange={onChange}
					/>
					<div className="settings-pane">
						{current.kind === "host" && (
							<HostPane
								draft={draft}
								response={response}
								index={current.index}
								onChange={onChange}
								onRename={onRenameHost}
								onRemoved={() => setSelection(null)}
								testResults={testResults}
								testing={testing}
								onTest={onTest}
							/>
						)}
						{current.kind === "repo" && (
							<RepoPane
								draft={draft}
								response={response}
								index={current.index}
								onChange={onChange}
								onRename={onRenameRepo}
								onRemoved={() => setSelection(null)}
							/>
						)}
						{current.kind === "process" && (
							<ProcessPane draft={draft} onChange={onChange} />
						)}
						{archivedRepo !== null && (
							<ArchivedPane
								name={archivedRepo.name}
								nameForAction={archivedRepo.name}
								holding={`Removed, not deleted. It is still holding ${costLabel(archivedRepo)}, and restoring brings all of it back.`}
								confirmDelete={`Permanently delete ${archivedRepo.name} and ${costLabel(archivedRepo)}? This cannot be undone.`}
								onRestore={() => {
									// Its host may have gone with it, in which case that has
									// to come back first or the document names a host that is
									// not there.
									const host = response.status.archived_hosts.find(
										(candidate) => candidate.id === archivedRepo.host_id,
									);
									const withHost =
										host !== undefined &&
										!draft.hosts.some((h) => h.id === host.id)
											? restoreHost(draft, host)
											: draft;
									onChange(restoreRepo(withHost, archivedRepo));
									// It lands at the end of the document, which is where
									// `restoreRepo` appends it — and the pane follows it out
									// of the archived group rather than offering to restore
									// something the document already names.
									setSelection({ kind: "repo", index: draft.repos.length });
								}}
								onDelete={() => onDeleteRepo(archivedRepo.id)}
							/>
						)}
						{archivedHost !== null && (
							<ArchivedPane
								name={archivedHost.id}
								nameForAction={`host ${archivedHost.id}`}
								holding="Removed, not deleted. Every repository that was on it is archived too, and restoring the host is what lets them come back."
								confirmDelete={`Permanently delete host ${archivedHost.id} and every repository under it? This cannot be undone.`}
								onRestore={() => {
									onChange(restoreHost(draft, archivedHost));
									setSelection({ kind: "host", index: draft.hosts.length });
								}}
								onDelete={() => onDeleteHost(archivedHost.id)}
							/>
						)}
					</div>
				</div>
			)}

			{/*
				Pinned rather than trailing the pane. The pane scrolls and the rail
				scrolls, so actions placed inside either one could be scrolled out of
				reach of a change made in the other; and a Save that is always visible
				and usually disabled says what this window does — it stages the whole
				document, and nothing reaches the file until you press it.
			*/}
			<div className="settings-foot">
				<button
					type="button"
					className="btn-primary"
					disabled={!dirty || busy}
					onClick={onSave}
				>
					{saving ? "Saving…" : "Save"}
				</button>
				<button
					type="button"
					className="btn-plain"
					disabled={!dirty || busy}
					onClick={() => {
						onChange(structuredClone(saved));
						// The pane is addressed by position, and discarding can put
						// something else at that position — or nothing. Letting go of
						// the selection re-picks against the document restored, rather
						// than silently showing a different repository under the name
						// the user was last editing.
						setSelection(null);
					}}
				>
					Discard changes
				</button>
				<span className="settings-dirty secondary">
					{dirty ? "Unsaved changes" : "No unsaved changes"}
				</span>
			</div>
		</>
	);
}

/**
 * The window itself.
 *
 * `Panel` is not reused: it scrolls its whole body, and this window's rail and
 * pane scroll independently beneath a head and a foot that do not. It is the
 * same surface and the same behaviour, laid out differently.
 *
 * The backdrop is the one in the app that does *not* dismiss. Everywhere else
 * a click beside a window can only mean "not this"; here it would throw away
 * a form holding unsaved edits, so Escape and Close are the only ways out.
 */

function SettingsWindow({
	onClose,
	children,
}: {
	onClose: () => void;
	children: React.ReactNode;
}) {
	const surface = useRef<HTMLDivElement>(null);
	useDismissOnEscape(onClose);
	useModalFocus(surface);
	return (
		<div className="overlay">
			<div
				className="window settings-modal"
				role="dialog"
				aria-modal="true"
				aria-label="Settings"
				ref={surface}
				tabIndex={-1}
			>
				<div className="window-head">
					<h2>Settings</h2>
					<button
						type="button"
						className="btn-close"
						onClick={onClose}
						aria-label="Close"
					>
						<X className="icon" aria-hidden="true" />
					</button>
				</div>
				{children}
			</div>
		</div>
	);
}

export function SettingsModal({ onClose }: { onClose: () => void }) {
	const config = useConfig();
	const save = useSaveConfig();
	const renameRepoMutation = useRenameRepo();
	const renameHostMutation = useRenameHost();
	const deleteRepo = useDeleteRepo();
	const deleteHost = useDeleteHost();
	const test = useTestHost();

	const [draft, setDraft] = useState<ConfigDocument | null>(null);
	const [results, setResults] = useState<Record<string, HostTestResult>>({});

	// Re-seeded whenever the server hands back a new document — after a save, a
	// rename, or a delete — so the form shows what was actually written rather
	// than the draft that asked for it.
	const saved = config.data?.config ?? null;
	useEffect(() => {
		if (saved !== null) setDraft(structuredClone(saved));
	}, [saved]);

	if (config.isPending) {
		return (
			<SettingsWindow onClose={onClose}>
				<div className="settings-empty">
					<p className="secondary">Loading…</p>
				</div>
			</SettingsWindow>
		);
	}

	const response = config.data;
	if (response === undefined || saved === null || draft === null) {
		return (
			<SettingsWindow onClose={onClose}>
				<div className="settings-empty">
					<div className="state state-error">
						<p className="state-title">Could not read the config</p>
						<p className="state-hint">{config.error?.message}</p>
					</div>
				</div>
			</SettingsWindow>
		);
	}

	const hash = response.hash;
	return (
		<SettingsWindow onClose={onClose}>
			<SettingsForm
				response={response}
				draft={draft}
				saved={saved}
				onChange={setDraft}
				onSave={() => save.mutate({ config: draft, hash })}
				onRenameRepo={(repoId, name) =>
					renameRepoMutation.mutate({ repoId, name, hash })
				}
				onRenameHost={(hostId, name) =>
					renameHostMutation.mutate({ hostId, name, hash })
				}
				onDeleteRepo={(repoId) => deleteRepo.mutate(repoId)}
				onDeleteHost={(hostId) => deleteHost.mutate(hostId)}
				onTest={(hostId) =>
					test.mutate(hostId, {
						onSuccess: (result) =>
							setResults((current) => ({ ...current, [hostId]: result })),
					})
				}
				testResults={results}
				testing={test.isPending}
				saving={save.isPending}
				busy={
					save.isPending ||
					renameRepoMutation.isPending ||
					renameHostMutation.isPending ||
					deleteRepo.isPending ||
					deleteHost.isPending
				}
				error={
					save.error ??
					renameRepoMutation.error ??
					renameHostMutation.error ??
					deleteRepo.error ??
					deleteHost.error ??
					null
				}
			/>
		</SettingsWindow>
	);
}
