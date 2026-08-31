import { useState } from "react";
import type {
	ConfigDocument,
	ConfigResponse,
	HostTestResult,
} from "../../../src/shared/api.ts";
import {
	formatGlobs,
	parseGlobs,
	removeHost,
	removeRepo,
	updateHost,
	updateRepo,
} from "../lib/config.ts";
import { ConfirmDialog } from "./Dialog.tsx";

/**
 * The right-hand side of the settings window: whichever one entity is
 * selected, and the fields that edit it. Every pane is given its slice of the
 * draft and a way to change it, and holds no state of its own beyond a rename
 * in progress.
 */

/** Says what archiving would take with it, in the numbers that make it concrete. */
export function costLabel(cost: {
	entries: number;
	verified_rules: number;
}): string {
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
 * A number field that keeps what was typed and commits only what parses.
 *
 * The draft therefore never holds `NaN` or a number nobody chose: a box that is
 * empty or half-typed is a string that has not parsed yet, not a value. Leaving
 * it that way is not a way to lose the number either, because blur puts the
 * last committed one back — so a field abandoned mid-edit resolves to the
 * number that was already there rather than to a zero the user never asked for.
 *
 * It carries no accessible name of its own. It renders inside `Field`'s label,
 * which is the association.
 */
function NumericInput({
	value,
	onValue,
}: {
	value: number;
	onValue: (next: number) => void;
}) {
	const [text, setText] = useState(String(value));
	const [prevValue, setPrevValue] = useState(value);

	/*
		A change that came from somewhere else — discarding the draft, or a save
		round-trip — has to reach the box. A change this box caused must not,
		because the value arriving back is the one the text already says, and
		reformatting it under the cursor would fight whoever is typing.
	*/
	if (prevValue !== value) {
		setPrevValue(value);
		if (Number(text) !== value) setText(String(value));
	}

	return (
		<input
			type="text"
			inputMode="numeric"
			value={text}
			onChange={(event) => {
				const next = event.target.value;
				setText(next);
				// `Number("")` is 0, which is a number the user did not type.
				const parsed = Number(next);
				if (next.trim() !== "" && Number.isFinite(parsed)) onValue(parsed);
			}}
			onBlur={() => setText(String(value))}
		/>
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
	onRename,
}: {
	current: string;
	/** Names the text box, and the Save that commits it. */
	label: string;
	/** Names the button that opens this. Hosts and repositories both have one. */
	action: string;
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
				disabled={value === current || value.trim() === ""}
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

/**
 * A host is five text fields that differ only in which key they write, so they
 * are declared rather than repeated. The order is the order they render in.
 */
const HOST_FIELDS: {
	key: "label" | "api_base" | "graphql" | "web_base" | "token_env";
	label: string;
	hint?: string;
}[] = [
	{ key: "label", label: "Label" },
	{ key: "api_base", label: "API base" },
	{ key: "graphql", label: "GraphQL endpoint" },
	{
		key: "web_base",
		label: "Web base",
		hint: "Where this host's repositories are browsed.",
	},
	{
		key: "token_env",
		label: "Token variable",
		hint: "The name of an environment variable. NOTAM never stores the token itself.",
	},
];

/**
 * What the pane is showing.
 *
 * Hosts and repositories are addressed by their position in the draft because
 * that is what every edit in `lib/config.ts` takes, and because a host being
 * configured for the first time has no id to address it by yet. Archived rows
 * are addressed by id instead: they live on the server's status rather than in
 * the draft, and nothing reorders them.
 */

export function HostPane({
	draft,
	response,
	index,
	onChange,
	onRename,
	onRemoved,
	testResults,
	onTest,
	testing,
}: {
	draft: ConfigDocument;
	response: ConfigResponse;
	index: number;
	onChange: (next: ConfigDocument) => void;
	onRename: (hostId: string, next: string) => void;
	onRemoved: () => void;
	testResults: Record<string, HostTestResult>;
	onTest: (hostId: string) => void;
	testing: boolean;
}) {
	const [confirming, setConfirming] = useState(false);
	const host = draft.hosts[index];
	if (host === undefined) return null;
	const status = response.status.hosts.find((h) => h.id === host.id);
	const result = testResults[host.id];

	/**
	 * Everything a host takes with it, summed across its repositories.
	 *
	 * Removing a host is the most expensive thing in this window — the
	 * repositories under it cannot stay in a document that no longer names
	 * their host, so they archive too — and it is the one place where what
	 * disappears is not on screen next to the button.
	 */
	const under = response.status.repos.filter((row) => row.host === host.id);
	const cost = {
		repos: under.length,
		entries: under.reduce((sum, row) => sum + row.entries, 0),
		verified_rules: under.reduce((sum, row) => sum + row.verified_rules, 0),
	};

	return (
		<>
			<div className="pane-head">
				<h3 className="pane-title mono">{host.id || "New host"}</h3>
				{host.id !== "" && (
					<RenameControl
						current={host.id}
						label={`new id for host ${host.id}`}
						action={`Rename host ${host.id}`}
						onRename={(next) => onRename(host.id, next)}
					/>
				)}
				<button
					type="button"
					className="btn-plain btn-sm btn-danger"
					aria-label={`Remove host ${host.id}`}
					onClick={() => {
						// A host with nothing under it costs nothing to remove, and a
						// dialog whose answer is never in doubt is one people learn to
						// dismiss without reading.
						if (cost.repos > 0) {
							setConfirming(true);
							return;
						}
						onChange(removeHost(draft, index));
						onRemoved();
					}}
				>
					Remove
				</button>
			</div>

			<div className="pane-fields">
				{/* The rail shows a zero here, and a zero is not an instruction. */}
				{host.id !== "" &&
					!draft.repos.some((repo) => repo.host === host.id) && (
						<p className="secondary">
							No repositories on this host yet. Add one, then sync it from the
							sidebar.
						</p>
					)}
				{host.id === "" && (
					<Field
						label="Id"
						hint="Used to refer to this host from a repository."
					>
						<input
							type="text"
							value={host.id}
							onChange={(event) =>
								onChange(updateHost(draft, index, { id: event.target.value }))
							}
						/>
					</Field>
				)}
				{HOST_FIELDS.map((field) => (
					<Field key={field.key} label={field.label} hint={field.hint}>
						<input
							type="text"
							value={host[field.key]}
							onChange={(event) =>
								onChange(
									updateHost(draft, index, {
										[field.key]: event.target.value,
									}),
								)
							}
						/>
					</Field>
				))}

				<p className="pane-note">
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

			{confirming && (
				<ConfirmDialog
					title="Remove"
					confirmLabel="Remove"
					confirmDanger
					message={`Removing ${host.id} also archives ${cost.repos} ${
						cost.repos === 1 ? "repository" : "repositories"
					} and ${costLabel(cost)}. They are kept and come back if you add it again.`}
					onCancel={() => setConfirming(false)}
					onConfirm={() => {
						setConfirming(false);
						onChange(removeHost(draft, index));
						onRemoved();
					}}
				/>
			)}
		</>
	);
}

export function RepoPane({
	draft,
	response,
	index,
	onChange,
	onRename,
	onRemoved,
}: {
	draft: ConfigDocument;
	response: ConfigResponse;
	index: number;
	onChange: (next: ConfigDocument) => void;
	onRename: (repoId: string, next: string) => void;
	onRemoved: () => void;
}) {
	const [confirming, setConfirming] = useState(false);
	const repo = draft.repos[index];
	if (repo === undefined) return null;
	// The document holds `(host, name)` and the lifecycle routes take an id, so
	// a repository the user has typed but not yet saved has neither an id nor a
	// cost — which is exactly right: it has no row behind it to rename or lose.
	const row =
		response.status.repos.find(
			(candidate) =>
				candidate.host === repo.host && candidate.name === repo.name,
		) ?? null;

	return (
		<>
			<div className="pane-head">
				<h3 className="pane-title mono">{repo.name || "New repository"}</h3>
				{row !== null && (
					<RenameControl
						current={repo.name}
						label={`new name for ${repo.name}`}
						action={`Rename ${repo.name}`}
						onRename={(next) => onRename(row.id, next)}
					/>
				)}
				<button
					type="button"
					className="btn-plain btn-sm btn-danger"
					aria-label={`Remove ${repo.name || "new repository"}`}
					onClick={() => {
						// A repository the user has typed but not yet saved has no row
						// behind it, and one with an empty row has nothing to lose, so
						// neither is worth stopping over.
						if (row !== null && row.entries + row.rules > 0) {
							setConfirming(true);
							return;
						}
						onChange(removeRepo(draft, index));
						onRemoved();
					}}
				>
					Remove
				</button>
			</div>

			<div className="pane-fields">
				{row === null && (
					<Field label="Name" hint="owner/repo">
						<input
							type="text"
							value={repo.name}
							onChange={(event) =>
								onChange(updateRepo(draft, index, { name: event.target.value }))
							}
						/>
					</Field>
				)}
				<Field
					label="Host"
					hint={
						row === null
							? undefined
							: "Fixed. A repository is identified by its host and its name together, so moving it between hosts is removing it from one and adding it to the other."
					}
				>
					<select
						value={repo.host}
						disabled={row !== null}
						onChange={(event) =>
							onChange(updateRepo(draft, index, { host: event.target.value }))
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
					<NumericInput
						value={repo.window_days}
						onValue={(next) =>
							onChange(updateRepo(draft, index, { window_days: next }))
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

			{/* The row carries the numbers the question is about, so there is
				nothing to ask without it. */}
			{confirming && row !== null && (
				<ConfirmDialog
					title="Remove"
					confirmLabel="Remove"
					confirmDanger
					message={`Removing ${repo.name} archives ${costLabel(row)}. They are kept and come back if you add it again.`}
					onCancel={() => setConfirming(false)}
					onConfirm={() => {
						setConfirming(false);
						onChange(removeRepo(draft, index));
						onRemoved();
					}}
				/>
			)}
		</>
	);
}

/**
 * Analysis and the server port in one pane, under one restart note.
 *
 * They are the same kind of thing — knobs on the process rather than on
 * anything you configured — and stating the restart caveat once makes it a
 * property of the group instead of boilerplate repeated per heading.
 */
export function ProcessPane({
	draft,
	onChange,
}: {
	draft: ConfigDocument;
	onChange: (next: ConfigDocument) => void;
}) {
	return (
		<>
			<div className="pane-head">
				<h3 className="pane-title">Process</h3>
			</div>
			<div className="pane-fields">
				<p className="secondary">Applied the next time NOTAM starts.</p>
				<Field label="Concurrency" hint="Entries analysed at once, 1 to 16.">
					<NumericInput
						value={draft.analysis.concurrency}
						onValue={(next) =>
							onChange({
								...draft,
								analysis: { ...draft.analysis, concurrency: next },
							})
						}
					/>
				</Field>
				<Field label="Timeout (seconds)">
					<NumericInput
						value={draft.analysis.timeout_seconds}
						onValue={(next) =>
							onChange({
								...draft,
								analysis: { ...draft.analysis, timeout_seconds: next },
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
				<Field label="Port">
					<NumericInput
						value={draft.server.port}
						onValue={(next) => onChange({ ...draft, server: { port: next } })}
					/>
				</Field>
			</div>
		</>
	);
}

/**
 * A host and a repository read the same way once archived: a name, a note on
 * what is being kept, and the two things you can do about it. Only the words
 * and the two callbacks differ, so they are parameters rather than a second
 * component.
 */
export function ArchivedPane({
	name,
	nameForAction,
	holding,
	onRestore,
	onDelete,
	confirmDelete,
}: {
	name: string;
	/** How the actions name it: a repository by name, a host as "host <id>". */
	nameForAction: string;
	holding: string;
	onRestore: () => void;
	onDelete: () => void;
	confirmDelete: string;
}) {
	const [confirming, setConfirming] = useState(false);
	return (
		<>
			<div className="pane-head">
				<h3 className="pane-title mono">{name}</h3>
				<span className="chip">Archived</span>
			</div>
			<div className="pane-fields">
				<p className="secondary">{holding}</p>
				<div className="pane-actions">
					<button
						type="button"
						aria-label={`Restore ${nameForAction}`}
						onClick={onRestore}
					>
						Restore
					</button>
					<button
						type="button"
						className="btn-danger"
						aria-label={`Delete ${nameForAction} permanently`}
						onClick={() => setConfirming(true)}
					>
						Delete permanently
					</button>
				</div>
			</div>

			{confirming && (
				<ConfirmDialog
					title="Delete permanently"
					confirmLabel="Delete permanently"
					confirmDanger
					message={confirmDelete}
					onCancel={() => setConfirming(false)}
					onConfirm={() => {
						setConfirming(false);
						onDelete();
					}}
				/>
			)}
		</>
	);
}
