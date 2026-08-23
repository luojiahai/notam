import { describe, expect, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RepoBar } from "../../web/src/components/RepoBar.tsx";

type Props = Parameters<typeof RepoBar>[0];

function draw(overrides: Partial<Props> = {}) {
	const calls = { synced: 0 };
	const props: Props = {
		repoName: "acme/mono",
		syncedAt: "2026-08-20T10:00:00.000Z",
		onSync: () => {
			calls.synced++;
		},
		syncing: false,
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

	/**
	 * A second sync queued on top of a running one would run the same
	 * repository twice, so the button goes down for the duration and says why.
	 */
	test("while syncing the button is disabled and reports its state", async () => {
		const calls = draw({ syncing: true });
		const button = screen.getByRole("button", { name: /syncing/i });
		expect(button.hasAttribute("disabled")).toBe(true);
		await userEvent.click(button);
		expect(calls.synced).toBe(0);
	});
});
