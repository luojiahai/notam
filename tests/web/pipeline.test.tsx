import { describe, expect, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { RepoSummary } from "../../src/shared/api.ts";
import type { Stage } from "../../web/src/components/Pipeline.tsx";
import { Pipeline } from "../../web/src/components/Pipeline.tsx";

const repo: RepoSummary = {
	id: "r_1",
	name: "acme/mono",
	host_id: "github",
	host_label: "GitHub",
	url: "https://github.com/acme/mono",
	default_branch: "main",
	path_globs: [],
	window_days: 180,
	sync_watermark: null,
	sync: { state: "idle", started_at: null, last: null },
	entries: {
		total: 12,
		unanalysed: 7,
		queued: 0,
		running: 0,
		analysed: 4,
		failed: 1,
	},
	rules: { total: 9, draft: 5, proposed: 2, verified: 1, abandoned: 3 },
	open_promotions: 1,
};

function draw(stage: Stage = "sources", overrides: Partial<RepoSummary> = {}) {
	const picked: Stage[] = [];
	render(
		<Pipeline
			repo={{ ...repo, ...overrides }}
			stage={stage}
			onStageChange={(next) => picked.push(next)}
		/>,
	);
	return picked;
}

function labels() {
	return screen
		.getAllByRole("tab")
		.map((tab) => tab.querySelector(".stage-label")?.textContent);
}

describe("Pipeline", () => {
	test("lays the stages out in the order an agreement travels", () => {
		draw();
		expect(labels()).toEqual([
			"Sources",
			"Draft",
			"In review",
			"Adopted",
			"Set aside",
		]);
	});

	test("each stage carries its own count", () => {
		draw();
		expect(
			screen
				.getAllByRole("tab")
				.map((tab) => tab.querySelector(".stage-value")?.textContent),
		).toEqual(["12", "5", "2", "1", "3"]);
	});

	/**
	 * The count alone is a quantity; the caption is the reason to click. A stage
	 * with nothing waiting has to say so rather than fall silent, which reads as
	 * a stage that failed to load.
	 */
	test("captions say what the number means, at zero as well as above it", () => {
		draw("sources", {
			entries: {
				total: 12,
				unanalysed: 0,
				queued: 0,
				running: 0,
				analysed: 12,
				failed: 0,
			},
			rules: { total: 0, draft: 0, proposed: 0, verified: 0, abandoned: 0 },
			open_promotions: 0,
		});
		expect(screen.getByText("all analysed")).toBeDefined();
		expect(screen.getByText("nothing waiting")).toBeDefined();
		expect(screen.getByText("nothing in flight")).toBeDefined();
		expect(screen.getByText("nothing adopted yet")).toBeDefined();
	});

	test("work in flight outranks the backlog in the sources caption", () => {
		draw("sources", {
			entries: {
				total: 12,
				unanalysed: 5,
				queued: 1,
				running: 2,
				analysed: 4,
				failed: 0,
			},
		});
		expect(screen.getByText("3 in analysis")).toBeDefined();
	});

	/** A failed analysis is unmined ore too: it is work still owed. */
	test("the backlog counts failures alongside the unanalysed", () => {
		draw("sources", {
			entries: {
				total: 12,
				unanalysed: 5,
				queued: 0,
				running: 0,
				analysed: 4,
				failed: 3,
			},
		});
		expect(screen.getByText("8 unanalysed")).toBeDefined();
	});

	test("marks the live stage and reports a click on another", async () => {
		const picked = draw("draft");
		expect(
			screen.getByRole("tab", { name: /Draft/ }).getAttribute("aria-selected"),
		).toBe("true");
		await userEvent.click(screen.getByRole("tab", { name: /Adopted/ }));
		expect(picked).toEqual(["adopted"]);
	});

	/**
	 * A tablist promises the keyboard that the whole run is one stop. Leaving
	 * five separate stops in the sequence would be worse than the plain buttons
	 * this replaced, because a screen reader announces the arrows as available.
	 */
	test("only the live stage is in the tab sequence", () => {
		draw("review");
		const stops = screen
			.getAllByRole("tab")
			.filter((tab) => tab.getAttribute("tabindex") === "0")
			.map((tab) => tab.querySelector(".stage-label")?.textContent);
		expect(stops).toEqual(["In review"]);
	});

	test("the arrows move along the run and wrap at both ends", async () => {
		const forward = draw("draft");
		screen.getByRole("tab", { name: /Draft/ }).focus();
		await userEvent.keyboard("{ArrowRight}");
		expect(forward).toEqual(["review"]);

		screen.getByRole("tab", { name: /Draft/ }).focus();
		await userEvent.keyboard("{ArrowLeft}");
		expect(forward).toEqual(["review", "sources"]);
	});

	test("the run wraps past its own ends rather than dead-ending", async () => {
		const picked = draw("sources");
		screen.getByRole("tab", { name: /Sources/ }).focus();
		await userEvent.keyboard("{ArrowLeft}");
		// Off the front of the run is the far end of it, which is Set aside.
		expect(picked).toEqual(["aside"]);
	});

	test("Home and End jump to the ends of the run", async () => {
		const picked = draw("review");
		screen.getByRole("tab", { name: /In review/ }).focus();
		await userEvent.keyboard("{Home}");
		await userEvent.keyboard("{End}");
		expect(picked).toEqual(["sources", "aside"]);
	});

	test("keys that are not its own are left alone", async () => {
		const picked = draw("draft");
		screen.getByRole("tab", { name: /Draft/ }).focus();
		await userEvent.keyboard("{ArrowUp}");
		await userEvent.keyboard("a");
		expect(picked).toEqual([]);
	});
});
