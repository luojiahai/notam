import { useState } from "react";
import type { AnalysisState } from "../../../src/shared/api.ts";
import { useAnalyse, useEntries } from "../api/hooks.ts";
import { EntriesTable } from "./EntriesTable.tsx";
import { TableError } from "./TableState.tsx";

export function EntriesTab({
	repoId,
	onOpenEntry,
	onCancel,
	onCancelAll,
	stopped,
}: {
	repoId: string;
	onOpenEntry: (entryId: string) => void;
	onCancel: (entryIds: string[]) => void;
	onCancelAll: () => void;
	/** How many the last stop press stopped, or null if there has not been one. */
	stopped: number | null;
}) {
	const [state, setState] = useState<AnalysisState | "">("");
	const [query, setQuery] = useState("");
	const entries = useEntries(repoId, state, query);
	const analyse = useAnalyse();

	/**
	 * The acknowledgement for a stop press, from the response to the very click
	 * that asked for it. Nothing else can report it: a stopped entry goes back
	 * to the state it came from, so the table alone cannot say it ever ran.
	 */
	const status = stopped === null ? null : `Stopped ${stopped}`;

	if (entries.error) {
		return <TableError message={entries.error.message} />;
	}

	return (
		<EntriesTable
			entries={entries.data?.entries ?? []}
			counts={
				entries.data?.counts ?? {
					total: 0,
					unanalysed: 0,
					queued: 0,
					running: 0,
					analysed: 0,
					failed: 0,
				}
			}
			state={state}
			onStateChange={setState}
			query={query}
			onQueryChange={setQuery}
			onOpenEntry={onOpenEntry}
			onAnalyse={(ids) => analyse.mutate(ids)}
			onCancel={onCancel}
			onCancelAll={onCancelAll}
			loading={entries.isPending}
			// Verbatim server text: a queue refusal is only visible here.
			error={analyse.error?.message ?? null}
			status={status}
		/>
	);
}
