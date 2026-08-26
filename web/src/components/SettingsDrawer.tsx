import { useEffect, useState } from "react";
import type {
	ArchivedHost,
	ArchivedRepo,
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
	addRepo,
	blankHost,
	blankRepo,
	formatGlobs,
	isDirty,
	parseGlobs,
	removeHost,
	removeRepo,
	restoreHost,
	restoreRepo,
	updateHost,
	updateRepo,
} from "../lib/config.ts";
import { Drawer } from "./Drawer.tsx";

/** Says what archiving would take with it, in the numbers that make it concrete. */
function costLabel(cost: { entries: number; verified_rules: number }): string {
	const entries = `${cost.entries} ${cost.entries === 1 ? "entry" : "entries"}`;
	const verified = `${cost.verified_rules} verified ${
		cost.verified_rules === 1 ? "rule" : "rules"
	}`;
	return `${entries} and ${verified}`;
}

function Field({
	label,
	hint,
	children,
}: {
	label: string;
	hint?: string;
	children: React.ReactNode;
}) {
	return (
		<div className="field">
			{/*
				The hint sits outside the label deliberately. Inside, it is read as
				part of the control's accessible name, and every field would announce
				itself as its label followed by a sentence of prose.
			*/}
			{/* biome-ignore lint/a11y/noLabelWithoutControl: the control is `children` — always an input, select, or textarea nested inside this label, which is the association. The rule cannot see through a generic child. */}
			<label className="field-control">
				<span className="field-label">{label}</span>
				{children}
			</label>
			{hint !== undefined && <span className="field-hint">{hint}</span>}
		</div>
	);
}

/**
 * A host's id is its primary key and a repository's identity is its name, so
 * neither is an ordinary field: typing over one in the document reads as the
 * old thing leaving and a new empty one arriving. Renaming through here goes
 * to its own endpoint, which moves the rows rather than replacing them.
 */
function RenameControl({
	current,
	label,
	action,
	busy,
	onRename,
}: {
	current: string;
	/** Names the text box, and the Save that commits it. */
	label: string;
	/** Names the button that opens this. Hosts and repositories both have one. */
	action: string;
	busy: boolean;
	onRename: (next: string) => void;
}) {
	const [open, setOpen] = useState(false);
	const [value, setValue] = useState(current);

	if (!open) {
		return (
			<button
				type="button"
				className="btn-plain btn-sm"
				aria-label={action}
				onClick={() => {
					setValue(current);
					setOpen(true);
				}}
			>
				Rename
			</button>
		);
	}

	return (
		<span className="rename">
			<input
				type="text"
				aria-label={label}
				value={value}
				onChange={(event) => setValue(event.target.value)}
			/>
			<button
				type="button"
				className="btn-primary btn-sm"
				aria-label={`Save ${label}`}
				disabled={busy || value === current || value.trim() === ""}
				onClick={() => {
					onRename(value.trim());
					setOpen(false);
				}}
			>
				Save name
			</button>
			<button
				type="button"
				className="btn-plain btn-sm"
				onClick={() => setOpen(false)}
			>
				Cancel
			</button>
		</span>
	);
}

function HostSection({
	draft,
	response,
	onChange,
	onRename,
	testResults,
	onTest,
	testing,
}: {
	draft: ConfigDocument;
	response: ConfigResponse;
	onChange: (next: ConfigDocument) => void;
	onRename: (hostId: string, next: string) => void;
	testResults: Record<string, HostTestResult>;
	onTest: (hostId: string) => void;
	testing: boolean;
}) {
	return (
		<>
			<h3>Hosts</h3>
			{draft.hosts.map((host, index) => {
				const status = response.status.hosts.find((h) => h.id === host.id);
				const result = testResults[host.id];
				return (
					<div className="card" key={host.id === "" ? `new-${index}` : host.id}>
						<div className="card-head">
							<span className="card-title mono">{host.id || "New host"}</span>
							{host.id !== "" && (
								<RenameControl
									current={host.id}
									label={`new id for host ${host.id}`}
									action={`Rename host ${host.id}`}
									busy={false}
									onRename={(next) => onRename(host.id, next)}
								/>
							)}
							<button
								type="button"
								className="btn-plain btn-sm btn-danger"
								aria-label={`Remove host ${host.id}`}
								onClick={() => onChange(removeHost(draft, index))}
							>
								Remove
							</button>
						</div>

						{host.id === "" && (
							<Field
								label="Id"
								hint="Used to refer to this host from a repository."
							>
								<input
									type="text"
									value={host.id}
									onChange={(event) =>
										onChange(
											updateHost(draft, index, { id: event.target.value }),
										)
									}
								/>
							</Field>
						)}
						<Field label="Label">
							<input
								type="text"
								value={host.label}
								onChange={(event) =>
									onChange(
										updateHost(draft, index, { label: event.target.value }),
									)
								}
							/>
						</Field>
						<Field label="API base">
							<input
								type="text"
								value={host.api_base}
								onChange={(event) =>
									onChange(
										updateHost(draft, index, { api_base: event.target.value }),
									)
								}
							/>
						</Field>
						<Field label="GraphQL endpoint">
							<input
								type="text"
								value={host.graphql}
								onChange={(event) =>
									onChange(
										updateHost(draft, index, { graphql: event.target.value }),
									)
								}
							/>
						</Field>
						<Field
							label="Web base"
							hint="Where this host's repositories are browsed."
						>
							<input
								type="text"
								value={host.web_base}
								onChange={(event) =>
									onChange(
										updateHost(draft, index, { web_base: event.target.value }),
									)
								}
							/>
						</Field>
						<Field
							label="Token variable"
							hint="The name of an environment variable. NOTAM never stores the token itself."
						>
							<input
								type="text"
								value={host.token_env}
								onChange={(event) =>
									onChange(
										updateHost(draft, index, { token_env: event.target.value }),
									)
								}
							/>
						</Field>

						<p className="card-foot">
							{status?.token_present === false && (
								<span className="secondary">
									{host.token_env} is not set. Export it and restart.
								</span>
							)}
							{status?.token_present === true && (
								<span className="secondary">{host.token_env} is set.</span>
							)}
							<button
								type="button"
								className="btn-plain btn-sm"
								disabled={testing || host.id === ""}
								onClick={() => onTest(host.id)}
							>
								Test connection
							</button>
							{result !== undefined && (
								<span className={result.ok ? "secondary" : "field-error"}>
									{result.ok
										? `Connected${result.login === null ? "" : ` as ${result.login}`}.`
										: result.message}
								</span>
							)}
						</p>
					</div>
				);
			})}
			<button
				type="button"
				className="btn-plain btn-sm"
				onClick={() => onChange(addHost(draft, blankHost()))}
			>
				Add a host
			</button>
		</>
	);
}

function RepoSection({
	draft,
	response,
	onChange,
	onRename,
}: {
	draft: ConfigDocument;
	response: ConfigResponse;
	onChange: (next: ConfigDocument) => void;
	onRename: (repoId: string, next: string) => void;
}) {
	// The document holds `(host, name)` and the lifecycle routes take an id, so
	// a repository the user has typed but not yet saved has neither an id nor a
	// cost — which is exactly right: it has no row behind it to rename or lose.
	const rowFor = (hostId: string, name: string) =>
		response.status.repos.find(
			(row) => row.host === hostId && row.name === name,
		) ?? null;

	return (
		<>
			<h3>Repositories</h3>
			{draft.repos.length === 0 && (
				<p className="secondary">
					None yet. Add one below, then sync it from the sidebar.
				</p>
			)}
			{draft.repos.map((repo, index) => {
				const row = rowFor(repo.host, repo.name);
				return (
					<div className="card" key={`${repo.host}/${repo.name || index}`}>
						<div className="card-head">
							<span className="card-title mono">
								{repo.name || "New repository"}
							</span>
							{row !== null && (
								<RenameControl
									current={repo.name}
									label={`new name for ${repo.name}`}
									action={`Rename ${repo.name}`}
									busy={false}
									onRename={(next) => onRename(row.id, next)}
								/>
							)}
							<button
								type="button"
								className="btn-plain btn-sm btn-danger"
								aria-label={`Remove ${repo.name || "new repository"}`}
								onClick={() => {
									if (
										row !== null &&
										row.entries + row.rules > 0 &&
										!window.confirm(
											`Removing ${repo.name} archives ${costLabel(row)}. They are kept and come back if you add it again. Continue?`,
										)
									) {
										return;
									}
									onChange(removeRepo(draft, index));
								}}
							>
								Remove
							</button>
						</div>

						{row === null && (
							<Field label="Name" hint="owner/repo">
								<input
									type="text"
									value={repo.name}
									onChange={(event) =>
										onChange(
											updateRepo(draft, index, { name: event.target.value }),
										)
									}
								/>
							</Field>
						)}
						<Field label="Host">
							<select
								value={repo.host}
								onChange={(event) =>
									onChange(
										updateRepo(draft, index, { host: event.target.value }),
									)
								}
							>
								{draft.hosts.map((host) => (
									<option key={host.id} value={host.id}>
										{host.label || host.id}
									</option>
								))}
							</select>
						</Field>
						<Field
							label="Path globs"
							hint="One per line. Leave empty to sync every merged pull request."
						>
							<textarea
								rows={3}
								value={formatGlobs(repo.path_globs)}
								onChange={(event) =>
									onChange(
										updateRepo(draft, index, {
											path_globs: parseGlobs(event.target.value),
										}),
									)
								}
							/>
						</Field>
						<Field label="Default branch">
							<input
								type="text"
								value={repo.default_branch}
								onChange={(event) =>
									onChange(
										updateRepo(draft, index, {
											default_branch: event.target.value,
										}),
									)
								}
							/>
						</Field>
						<Field
							label="Window (days)"
							hint="How far back the first backfill reaches."
						>
							<input
								type="text"
								inputMode="numeric"
								value={String(repo.window_days)}
								onChange={(event) =>
									onChange(
										updateRepo(draft, index, {
											window_days: Number(event.target.value) || 0,
										}),
									)
								}
							/>
						</Field>
						<Field
							label="Prompt template"
							hint="Path to a Markdown file. Checked when you save."
						>
							<input
								type="text"
								value={repo.prompt_template ?? ""}
								onChange={(event) =>
									onChange(
										updateRepo(draft, index, {
											...(event.target.value === ""
												? { prompt_template: undefined }
												: { prompt_template: event.target.value }),
										}),
									)
								}
							/>
						</Field>
					</div>
				);
			})}
			<button
				type="button"
				className="btn-plain btn-sm"
				disabled={draft.hosts.length === 0}
				onClick={() =>
					onChange(addRepo(draft, blankRepo(draft.hosts[0]?.id ?? "")))
				}
			>
				Add a repository
			</button>
		</>
	);
}

function ArchivedSection({
	response,
	draft,
	onChange,
	onDeleteRepo,
	onDeleteHost,
}: {
	response: ConfigResponse;
	draft: ConfigDocument;
	onChange: (next: ConfigDocument) => void;
	onDeleteRepo: (repoId: string) => void;
	onDeleteHost: (hostId: string) => void;
}) {
	const { archived_hosts: hosts, archived_repos: repos } = response.status;
	if (hosts.length === 0 && repos.length === 0) return null;

	const restore = (archived: ArchivedRepo) => {
		// Its host may have gone with it, in which case that has to come back
		// first or the document names a host that is not there.
		const host = hosts.find((candidate) => candidate.id === archived.host_id);
		const withHost =
			host !== undefined && !draft.hosts.some((h) => h.id === host.id)
				? restoreHost(draft, host)
				: draft;
		onChange(restoreRepo(withHost, archived));
	};

	return (
		<>
			<h3>Archived</h3>
			<p className="secondary">
				Removed, not deleted. Everything they collected is still here, and
				restoring brings it back.
			</p>
			{repos.map((repo) => (
				<div className="card" key={repo.id}>
					<div className="card-head">
						<span className="card-title mono">{repo.name}</span>
						<button
							type="button"
							className="btn-plain btn-sm"
							aria-label={`Restore ${repo.name}`}
							onClick={() => restore(repo)}
						>
							Restore
						</button>
						<button
							type="button"
							className="btn-plain btn-sm btn-danger"
							aria-label={`Delete ${repo.name} permanently`}
							onClick={() => {
								if (
									window.confirm(
										`Permanently delete ${repo.name} and ${costLabel(repo)}? This cannot be undone.`,
									)
								) {
									onDeleteRepo(repo.id);
								}
							}}
						>
							Delete permanently
						</button>
					</div>
					<p className="secondary">Holding {costLabel(repo)}.</p>
				</div>
			))}
			{hosts.map((host: ArchivedHost) => (
				<div className="card" key={host.id}>
					<div className="card-head">
						<span className="card-title mono">{host.id}</span>
						<button
							type="button"
							className="btn-plain btn-sm"
							aria-label={`Restore host ${host.id}`}
							onClick={() => onChange(restoreHost(draft, host))}
						>
							Restore
						</button>
						<button
							type="button"
							className="btn-plain btn-sm btn-danger"
							aria-label={`Delete host ${host.id} permanently`}
							onClick={() => {
								if (
									window.confirm(
										`Permanently delete host ${host.id} and every repository under it? This cannot be undone.`,
									)
								) {
									onDeleteHost(host.id);
								}
							}}
						>
							Delete permanently
						</button>
					</div>
				</div>
			))}
		</>
	);
}

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

/** Everything the drawer renders, with no data fetching of its own. */
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

	return (
		<>
			<p className="secondary mono">{response.path}</p>
			<p className="secondary">
				NOTAM owns this file. Saving rewrites it whole, so comments you add do
				not survive. Editing it in a text editor works too — this drawer reads
				it fresh every time it opens.
			</p>

			{error !== null && (
				<div className="state state-error">
					<p className="state-title">Not saved</p>
					<p className="state-hint">{error.message}</p>
				</div>
			)}

			<HostSection
				draft={draft}
				response={response}
				onChange={onChange}
				onRename={onRenameHost}
				testResults={testResults}
				testing={testing}
				onTest={onTest}
			/>

			<RepoSection
				draft={draft}
				response={response}
				onChange={onChange}
				onRename={onRenameRepo}
			/>

			<h3>Analysis</h3>
			<p className="secondary">Applied the next time NOTAM starts.</p>
			<Field label="Concurrency" hint="Entries analysed at once, 1 to 16.">
				<input
					type="text"
					inputMode="numeric"
					value={String(draft.analysis.concurrency)}
					onChange={(event) =>
						onChange({
							...draft,
							analysis: {
								...draft.analysis,
								concurrency: Number(event.target.value) || 0,
							},
						})
					}
				/>
			</Field>
			<Field label="Timeout (seconds)">
				<input
					type="text"
					inputMode="numeric"
					value={String(draft.analysis.timeout_seconds)}
					onChange={(event) =>
						onChange({
							...draft,
							analysis: {
								...draft.analysis,
								timeout_seconds: Number(event.target.value) || 0,
							},
						})
					}
				/>
			</Field>
			<Field
				label="Model"
				hint="Leave empty to use the claude CLI's own default."
			>
				<input
					type="text"
					value={draft.analysis.model ?? ""}
					onChange={(event) =>
						onChange({
							...draft,
							analysis: {
								concurrency: draft.analysis.concurrency,
								timeout_seconds: draft.analysis.timeout_seconds,
								...(event.target.value === ""
									? {}
									: { model: event.target.value }),
							},
						})
					}
				/>
			</Field>

			<h3>Server</h3>
			<p className="secondary">Applied the next time NOTAM starts.</p>
			<Field label="Port">
				<input
					type="text"
					inputMode="numeric"
					value={String(draft.server.port)}
					onChange={(event) =>
						onChange({
							...draft,
							server: { port: Number(event.target.value) || 0 },
						})
					}
				/>
			</Field>

			<ArchivedSection
				response={response}
				draft={draft}
				onChange={onChange}
				onDeleteRepo={onDeleteRepo}
				onDeleteHost={onDeleteHost}
			/>

			<div className="drawer-actions">
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
					onClick={() => onChange(structuredClone(saved))}
				>
					Discard changes
				</button>
			</div>
		</>
	);
}

export function SettingsDrawer({ onClose }: { onClose: () => void }) {
	const config = useConfig(true);
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
			<Drawer title="Settings" onClose={onClose}>
				<p className="secondary">Loading…</p>
			</Drawer>
		);
	}

	const response = config.data;
	if (response === undefined || saved === null || draft === null) {
		return (
			<Drawer title="Settings" onClose={onClose}>
				<div className="state state-error">
					<p className="state-title">Could not read the config</p>
					<p className="state-hint">{config.error?.message}</p>
				</div>
			</Drawer>
		);
	}

	const hash = response.hash;
	return (
		<Drawer title="Settings" onClose={onClose}>
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
		</Drawer>
	);
}
