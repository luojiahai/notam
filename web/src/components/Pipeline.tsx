import type React from "react";
import type { RepoSummary } from "../../../src/shared/api.ts";

/**
 * Where a repository's work is, as one of five places.
 *
 * The first four are the stages an agreement passes through, in order: it is
 * analysed out of a merged pull request, judged, carried to the repository in
 * a pull request of its own, and finally adopted. `aside` is off that line —
 * an abandoned rule went nowhere — which is why it is a member here but not a
 * step in the run below.
 */
export type Stage = "sources" | "draft" | "review" | "adopted" | "aside";

export type PipelineProps = {
	repo: RepoSummary;
	stage: Stage;
	onStageChange: (stage: Stage) => void;
};

type Step = {
	stage: Stage;
	label: string;
	value: number;
	/** One line saying what the number means right now, not what it is. */
	caption: string;
};

/**
 * The captions carry the judgement the bare count cannot. "3" under Draft is a
 * quantity; "awaiting your call" is the reason to click. Each is derived from
 * the repository's own counts, so a stage that has nothing waiting says so
 * rather than falling silent and reading as broken.
 */
function steps(repo: RepoSummary): Step[] {
	const backlog = repo.entries.unanalysed + repo.entries.failed;
	const working = repo.entries.running + repo.entries.queued;
	return [
		{
			stage: "sources",
			label: "Sources",
			value: repo.entries.total,
			caption:
				working > 0
					? `${working} in analysis`
					: backlog > 0
						? `${backlog} unanalysed`
						: repo.entries.total === 0
							? "nothing synced"
							: "all analysed",
		},
		{
			stage: "draft",
			label: "Draft",
			value: repo.rules.draft,
			caption: repo.rules.draft > 0 ? "awaiting your call" : "nothing waiting",
		},
		{
			stage: "review",
			label: "In review",
			value: repo.rules.proposed,
			caption:
				repo.open_promotions > 0
					? `${repo.open_promotions} pull request${repo.open_promotions === 1 ? "" : "s"} open`
					: "nothing in flight",
		},
		{
			stage: "adopted",
			label: "Adopted",
			value: repo.rules.verified,
			caption:
				repo.rules.verified > 0 ? "the standing brief" : "nothing adopted yet",
		},
	];
}

export function stageTabId(stage: Stage): string {
	return `stage-tab-${stage}`;
}

/**
 * The workspace's one navigation control, and a map of the funnel at the same
 * time. It replaces a row of peer tabs because entries, rules and promotions
 * are not peers: a promotion is a stage a rule is in, and an entry is the ore
 * a rule was cut from. Laid out in order, with the counts on it, the bar
 * answers "where is there work" without opening anything.
 *
 * It carries tab semantics, which is a promise about the keyboard as much as
 * about the accessible tree: the whole run is one Tab stop, the arrows move
 * within it, and Home and End jump to its ends. A tablist that leaves five
 * separate stops in the sequence is worse than the plain buttons it replaced,
 * because a reader is told to expect the arrows and they do nothing.
 */
export function Pipeline({ repo, stage, onStageChange }: PipelineProps) {
	const run = steps(repo);
	// The order the keyboard walks, which is the order they are drawn in: the
	// off-line stage is last because it is last on screen, not because it is a
	// later stage than Adopted.
	const order: Stage[] = [...run.map((step) => step.stage), "aside"];

	/**
	 * Selection follows focus, which is the right choice here because moving to
	 * a stage is cheap and reversible and because the panel below is what the
	 * reader is arrowing along to see. The alternative — arrow to move, Enter to
	 * choose — is for tabs whose panels are expensive to load.
	 */
	function onKeyDown(event: React.KeyboardEvent): void {
		const at = order.indexOf(stage);
		const next =
			event.key === "ArrowRight"
				? order[(at + 1) % order.length]
				: event.key === "ArrowLeft"
					? order[(at - 1 + order.length) % order.length]
					: event.key === "Home"
						? order[0]
						: event.key === "End"
							? order[order.length - 1]
							: undefined;
		if (next === undefined) return;
		event.preventDefault();
		onStageChange(next);
		// The DOM node is focused directly rather than through state: React has
		// not re-rendered yet, and the tab that is about to become selected is
		// the one that has to end up holding the focus.
		document.getElementById(stageTabId(next))?.focus();
	}

	return (
		// Every tab is a direct child, which is what the role requires: wrapped
		// one level down they stop being this list's tabs, and assistive
		// technology stops reporting them as tabs at all. The arrows between them
		// are drawn by the stylesheet for the same reason — an element between
		// two tabs would be an element in a tablist that is not a tab.
		<div
			className="pipeline"
			role="tablist"
			aria-label="Stage"
			onKeyDown={onKeyDown}
		>
			{run.map((step) => (
				<button
					type="button"
					role="tab"
					id={stageTabId(step.stage)}
					className="stage"
					key={step.stage}
					aria-selected={stage === step.stage}
					tabIndex={stage === step.stage ? 0 : -1}
					onClick={() => onStageChange(step.stage)}
				>
					{/*
						The three lines are one accessible name, and they run
						together without these separators: "Draft3awaiting your call"
						is what a screen reader would announce, and what a test would
						have to match.
					*/}
					<span className="stage-label">{step.label}</span>{" "}
					<span className="stage-value">{step.value}</span>{" "}
					<span className="stage-caption">{step.caption}</span>
				</button>
			))}
			{/*
				Detached from the run and never given its weight: an abandoned rule
				is not a later stage of a proposed one, it is the branch where the
				answer was no, and abandonment is terminal. It stays reachable
				anyway, because the record of what a team decided against is worth
				as much as the record of what it adopted — and because a count that
				vanishes reads as data lost.
			*/}
			<button
				type="button"
				role="tab"
				id={stageTabId("aside")}
				className="stage stage-aside"
				aria-selected={stage === "aside"}
				onClick={() => onStageChange("aside")}
			>
				<span className="stage-label">Set aside</span>{" "}
				<span className="stage-value">{repo.rules.abandoned}</span>
			</button>
		</div>
	);
}
