import { useState } from "react";
import type { AnalysisState } from "../../../src/shared/api.ts";
import type { BatchState } from "../App.tsx";
import { useAnalyse, useAnalyseUnanalysed, useEntries } from "../api/hooks.ts";
import { EntriesTable } from "./EntriesTable.tsx";
import { TableError } from "./TableState.tsx";

export function EntriesTab({
	repoId,
	batch,
	onOpenEntry,
}: {
	repoId: string;
	batch: BatchState;
	onOpenEntry: (entryId: string) => void;
}) {
	const [state, setState] = useState<AnalysisState | "">("");
	const [query, setQuery] = useState("");
	const entries = useEntries(repoId, state, query);
	const analyse = useAnalyse();
	const analyseAll = useAnalyseUnanalysed();

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
			onAnalyseAllUnanalysed={() => analyseAll.mutate(repoId)}
			batch={batch}
			loading={entries.isPending}
			// Verbatim server text: a queue refusal is only visible here.
			error={analyse.error?.message ?? analyseAll.error?.message ?? null}
		/>
	);
}
