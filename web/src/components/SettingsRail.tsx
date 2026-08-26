import type {
	ArchivedHost,
	ArchivedRepo,
	ConfigDocument,
	ConfigResponse,
} from "../../../src/shared/api.ts";
import { addHost, addRepo, blankHost, blankRepo } from "../lib/config.ts";

/**
 * The left-hand side of the settings window: every configured entity, grouped
 * so that a repository sits under the host that owns it. The rail is where the
 * document's shape is visible; the pane beside it only ever shows one row of
 * that shape at a time.
 */
/**
 * What the pane is showing.
 *
 * Hosts and repositories are addressed by their position in the draft because
 * that is what every edit in `lib/config.ts` takes, and because a host being
 * configured for the first time has no id to address it by yet. Archived rows
 * are addressed by id instead: they live on the server's status rather than in
 * the draft, and nothing reorders them.
 */
export type Selection =
	| { kind: "host"; index: number }
	| { kind: "repo"; index: number }
	| { kind: "process" }
	| { kind: "archivedRepo"; id: string }
	| { kind: "archivedHost"; id: string };

function sameSelection(a: Selection, b: Selection): boolean {
	if (a.kind !== b.kind) return false;
	if ("index" in a && "index" in b) return a.index === b.index;
	if ("id" in a && "id" in b) return a.id === b.id;
	return true;
}

/**
 * A repository first, because it is what people come back to change; a host
 * only when there are no repositories yet, which is the shape of a first run.
 */
function defaultSelection(draft: ConfigDocument): Selection {
	if (draft.repos.length > 0) return { kind: "repo", index: 0 };
	if (draft.hosts.length > 0) return { kind: "host", index: 0 };
	return { kind: "process" };
}

/**
 * Removing what the pane was showing, or discarding a draft that added it,
 * leaves the selection pointing at nothing. Rather than track every edit that
 * could invalidate it, the selection is checked against the current draft on
 * every render and falls back when it no longer resolves.
 */
export function resolveSelection(
	selection: Selection | null,
	draft: ConfigDocument,
	archivedRepos: ArchivedRepo[],
	archivedHosts: ArchivedHost[],
): Selection {
	if (selection === null) return defaultSelection(draft);
	switch (selection.kind) {
		case "host":
			return selection.index < draft.hosts.length
				? selection
				: defaultSelection(draft);
		case "repo":
			return selection.index < draft.repos.length
				? selection
				: defaultSelection(draft);
		case "process":
			return selection;
		case "archivedRepo":
			return archivedRepos.some((repo) => repo.id === selection.id)
				? selection
				: defaultSelection(draft);
		case "archivedHost":
			return archivedHosts.some((host) => host.id === selection.id)
				? selection
				: defaultSelection(draft);
	}
}

function RailItem({
	label,
	current,
	child,
	standalone,
	count,
	onSelect,
}: {
	label: string;
	current: boolean;
	/** Indented under the host that owns it. */
	child?: boolean;
	/** Set apart from the entities above it. */
	standalone?: boolean;
	count?: number;
	onSelect: () => void;
}) {
	return (
		<button
			type="button"
			className={[
				"rail-item",
				child === true ? "rail-child" : "",
				standalone === true ? "rail-standalone" : "",
			]
				.filter((name) => name !== "")
				.join(" ")}
			// The name is the visible text, so speech control and a screen reader
			// ask for the same thing. The count is decoration on top of it.
			{...(current ? { "aria-current": true as const } : {})}
			onClick={onSelect}
		>
			<span className="mono">{label}</span>
			{count !== undefined && (
				<span className="rail-count" aria-hidden="true">
					{count}
				</span>
			)}
		</button>
	);
}

export function SettingsRail({
	draft,
	response,
	selection,
	onSelect,
	onChange,
}: {
	draft: ConfigDocument;
	response: ConfigResponse;
	selection: Selection;
	onSelect: (next: Selection) => void;
	onChange: (next: ConfigDocument) => void;
}) {
	/*
	 * Restoring puts the row back in the draft before the save that clears its
	 * `archived_at`, so for that moment the server still calls it archived while
	 * the document already names it. Listing it in both places would put two
	 * rail items under one name, so the draft wins: once it is in the document
	 * it is no longer somewhere you restore from.
	 */
	const archivedRepos = response.status.archived_repos.filter(
		(archived) =>
			!draft.repos.some(
				(repo) => repo.host === archived.host_id && repo.name === archived.name,
			),
	);
	const archivedHosts = response.status.archived_hosts.filter(
		(archived) => !draft.hosts.some((host) => host.id === archived.id),
	);

	return (
		<div className="settings-rail">
			<h3 className="rail-group">Hosts</h3>
			{draft.hosts.map((host, index) => (
				<div key={host.id === "" ? `new-${index}` : host.id}>
					<RailItem
						label={host.id || "New host"}
						count={draft.repos.filter((repo) => repo.host === host.id).length}
						current={sameSelection(selection, { kind: "host", index })}
						onSelect={() => onSelect({ kind: "host", index })}
					/>
					{draft.repos.map((repo, repoIndex) =>
						repo.host === host.id ? (
							<RailItem
								key={`${repo.host}/${repo.name || repoIndex}`}
								label={repo.name || "New repository"}
								child
								current={sameSelection(selection, {
									kind: "repo",
									index: repoIndex,
								})}
								onSelect={() => onSelect({ kind: "repo", index: repoIndex })}
							/>
						) : null,
					)}
				</div>
			))}
			{/*
				A repository whose host is not in the draft cannot happen through the
				form — but a hand-edited file reaches the browser before the schema
				rejects it, and a rail that silently dropped the row would hide the
				thing the reader opened this window to fix.
			*/}
			{draft.repos.map((repo, index) =>
				draft.hosts.some((host) => host.id === repo.host) ? null : (
					<RailItem
						key={`orphan-${repo.host}/${repo.name || index}`}
						label={repo.name || "New repository"}
						child
						current={sameSelection(selection, { kind: "repo", index })}
						onSelect={() => onSelect({ kind: "repo", index })}
					/>
				),
			)}

			<button
				type="button"
				className="rail-item rail-add"
				onClick={() => {
					onChange(addHost(draft, blankHost()));
					onSelect({ kind: "host", index: draft.hosts.length });
				}}
			>
				Add a host
			</button>
			<button
				type="button"
				className="rail-item rail-add"
				disabled={draft.hosts.length === 0}
				onClick={() => {
					onChange(addRepo(draft, blankRepo(draft.hosts[0]?.id ?? "")));
					onSelect({ kind: "repo", index: draft.repos.length });
				}}
			>
				Add a repository
			</button>

			{(archivedRepos.length > 0 || archivedHosts.length > 0) && (
				<>
					<h3 className="rail-group">Archived</h3>
					{archivedRepos.map((repo) => (
						<RailItem
							key={repo.id}
							label={repo.name}
							current={sameSelection(selection, {
								kind: "archivedRepo",
								id: repo.id,
							})}
							onSelect={() => onSelect({ kind: "archivedRepo", id: repo.id })}
						/>
					))}
					{archivedHosts.map((host) => (
						<RailItem
							key={host.id}
							label={host.id}
							current={sameSelection(selection, {
								kind: "archivedHost",
								id: host.id,
							})}
							onSelect={() => onSelect({ kind: "archivedHost", id: host.id })}
						/>
					))}
				</>
			)}

			{/*
				Last and on its own: the only pane that is not a thing you added.
			*/}
			<RailItem
				label="Process"
				standalone
				current={selection.kind === "process"}
				onSelect={() => onSelect({ kind: "process" })}
			/>
		</div>
	);
}
