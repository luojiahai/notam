import { useState } from "react";
import type { AnalysisState } from "../../../src/shared/api.ts";
import {
	useAnalyse,
	useCancelAnalysis,
	useCancelRepoAnalysis,
	useEntries,
} from "../api/hooks.ts";
import { EntriesTable } from "./EntriesTable.tsx";
import { TableError } from "./TableState.tsx";

export function EntriesTab({
	repoId,
	onOpenEntry,
}: {
	repoId: string;
	onOpenEntry: (entryId: string) => void;
}) {
	const [state, setState] = useState<AnalysisState | "">("");
	const [query, setQuery] = useState("");
	const entries = useEntries(repoId, state, query);
	const analyse = useAnalyse();
	const cancel = useCancelAnalysis();
	const cancelAll = useCancelRepoAnalysis();

	/**
	 * The acknowledgement for a stop press, taken from the response to the very
	 * click that asked for it. Nothing else reports it: a cancelled entry goes
	 * back to the state it came from, so the table alone cannot say whether it
	 * ever ran.
	 */
	const stopped = cancel.data ?? cancelAll.data ?? null;
	const status = stopped ? `Stopped ${stopped.cancelled.length}` : null;

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
			onCancel={(ids) => cancel.mutate(ids)}
			onCancelAll={() => cancelAll.mutate(repoId)}
			loading={entries.isPending}
			// Verbatim server text: a queue refusal is only visible here.
			error={analyse.error?.message ?? null}
			status={status}
		/>
	);
}
