import { describe, expect, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { RepoSync } from "../../src/shared/api.ts";
import { RepoBar } from "../../web/src/components/RepoBar.tsx";

type Props = Parameters<typeof RepoBar>[0];

const IDLE: RepoSync = { state: "idle", started_at: null, last: null };

function draw(overrides: Partial<Props> = {}) {
	const calls = { synced: 0, cancelled: 0 };
	const props: Props = {
		repoName: "acme/mono",
		repoUrl: "https://github.com/acme/mono",
		syncedAt: "2026-08-20T10:00:00.000Z",
		sync: IDLE,
		progress: null,
		onSync: () => {
			calls.synced++;
		},
		onCancelSync: () => {
			calls.cancelled++;
		},
		...overrides,
	};
	render(<RepoBar {...props} />);
	return calls;
}

describe("RepoBar", () => {
	test("names the repository the bar acts on", () => {
		draw();
		expect(screen.getByText("acme/mono")).toBeDefined();
	});

	test("links the repository to its page on the host that serves it", () => {
		draw();
		const link = screen.getByRole("link", { name: "acme/mono on GitHub" });
		expect(link.getAttribute("href")).toBe("https://github.com/acme/mono");
		expect(link.getAttribute("target")).toBe("_blank");
	});

	/**
	 * The watermark is the newest `merged_at` ingested, not the time of the
	 * last sync, so the label says "merged through" — calling it "synced" beside
	 * the Sync button would claim something the value cannot support.
	 */
	test("labels the watermark as the merge date it is, as an ISO day", () => {
		draw();
		expect(screen.getByText(/merged through 2026-08-20/i)).toBeDefined();
	});

	test("says nothing has been ingested when there is no watermark", () => {
		draw({ syncedAt: null });
		expect(screen.getByText(/nothing synced yet/i)).toBeDefined();
	});

	test("Sync reports a click", async () => {
		const calls = draw();
		await userEvent.click(screen.getByRole("button", { name: /^sync$/i }));
		expect(calls.synced).toBe(1);
	});

	test("offers no Stop when nothing is running", () => {
		draw();
		expect(screen.queryByRole("button", { name: /stop/i })).toBeNull();
	});

	describe("while a sync is running", () => {
		const RUNNING: RepoSync = {
			state: "running",
			started_at: "2026-08-23T09:00:00.000Z",
			last: null,
		};

		/**
		 * A second sync queued on top of a running one would run the same
		 * repository twice, so the button goes down for the duration and says why.
		 */
		test("disables Sync and says which reason it is down for", async () => {
			const calls = draw({ sync: RUNNING });
			const button = screen.getByRole("button", { name: /syncing/i });
			expect(button.hasAttribute("disabled")).toBe(true);
			expect(button.getAttribute("title")).toMatch(/already syncing/i);
			await userEvent.click(button);
			expect(calls.synced).toBe(0);
		});

		test("offers Stop as its own control, not as Sync changing verb", async () => {
			const calls = draw({ sync: RUNNING });
			await userEvent.click(screen.getByRole("button", { name: /stop/i }));
			expect(calls.cancelled).toBe(1);
			expect(calls.synced).toBe(0);
		});

		test("shows a rising tally once progress arrives", () => {
			draw({
				sync: RUNNING,
				progress: { scanned: 142, created: 28, updated: 2, skipped: 112 },
			});
			expect(screen.getByText(/142 scanned/)).toBeDefined();
			expect(screen.getByText(/30 stored/)).toBeDefined();
		});

		test("says it is scanning before the first tally arrives", () => {
			draw({ sync: RUNNING });
			expect(screen.getByText(/scanning…/i)).toBeDefined();
		});
	});

	test("distinguishes queued from running on the disabled button", () => {
		draw({ sync: { state: "queued", started_at: null, last: null } });
		const button = screen.getByRole("button", { name: /^sync$/i });
		expect(button.hasAttribute("disabled")).toBe(true);
		expect(button.getAttribute("title")).toMatch(/already queued/i);
		expect(screen.getByText(/queued/i)).toBeDefined();
	});

	describe("the last sync's outcome", () => {
		test("reports a failure, which the watermark alone cannot", () => {
			draw({
				sync: {
					state: "idle",
					started_at: null,
					last: {
						outcome: "failed",
						at: "2026-08-23T09:00:09.000Z",
						error: "401 Bad credentials",
					},
				},
			});
			expect(screen.getByText(/last sync failed/i)).toBeDefined();
		});

		test("calls a cancelled sync stopped, never failed", () => {
			draw({
				sync: {
					state: "idle",
					started_at: null,
					last: {
						outcome: "cancelled",
						at: "2026-08-23T09:00:09.000Z",
						error: null,
					},
				},
			});
			expect(screen.getByText(/last sync stopped/i)).toBeDefined();
			expect(screen.queryByText(/failed/i)).toBeNull();
		});

		test("says nothing after a sync that simply worked", () => {
			draw({
				sync: {
					state: "idle",
					started_at: null,
					last: {
						outcome: "done",
						at: "2026-08-23T09:00:09.000Z",
						error: null,
					},
				},
			});
			expect(screen.queryByText(/last sync/i)).toBeNull();
		});
	});
});
