import { describe, expect, test } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import type { ConfigDocument, ConfigResponse } from "../../src/shared/api.ts";
import {
	SettingsForm,
	type SettingsFormProps,
} from "../../web/src/components/SettingsModal.tsx";

const DOC: ConfigDocument = {
	hosts: [
		{
			id: "github",
			label: "GitHub",
			api_base: "https://api.github.com",
			graphql: "https://api.github.com/graphql",
			web_base: "https://github.com",
			token_env: "NOTAM_GITHUB_TOKEN",
		},
	],
	repos: [
		{
			host: "github",
			name: "acme/mono",
			path_globs: ["services/payments/**"],
			default_branch: "main",
			window_days: 180,
		},
	],
	analysis: { concurrency: 3, timeout_seconds: 120 },
	server: { port: 4317 },
};

const RESPONSE: ConfigResponse = {
	config: DOC,
	hash: "abc123",
	path: "/home/dana/.notam/config.yaml",
	status: {
		hosts: [
			{
				id: "github",
				token_env: "NOTAM_GITHUB_TOKEN",
				token_present: true,
			},
		],
		repos: [
			{
				id: "r_1",
				host: "github",
				name: "acme/mono",
				entries: 42,
				rules: 7,
				verified_rules: 3,
			},
		],
		archived_hosts: [],
		archived_repos: [],
	},
};

function props(overrides: Partial<SettingsFormProps> = {}): SettingsFormProps {
	return {
		response: RESPONSE,
		draft: DOC,
		saved: DOC,
		onChange: () => {},
		onSave: () => {},
		onRenameRepo: () => {},
		onRenameHost: () => {},
		onDeleteRepo: () => {},
		onDeleteHost: () => {},
		onTest: () => {},
		testResults: {},
		busy: false,
		saving: false,
		testing: false,
		error: null,
		...overrides,
	};
}

/**
 * Opens a pane. One entity is on screen at a time, so a test that asserts on a
 * host's fields has to say which host, the same way a reader does.
 */
function select(name: string): void {
	fireEvent.click(screen.getByRole("button", { name }));
}

/**
 * Holds its own draft, so an edit changes what is on screen. The tests that
 * assert on what a removal leaves behind need the form to re-render against
 * the document the removal produced.
 */
function Stateful({
	initial,
	overrides = {},
}: {
	initial: ConfigDocument;
	overrides?: Partial<SettingsFormProps>;
}) {
	const [draft, setDraft] = useState(initial);
	return (
		<SettingsForm {...props({ draft, onChange: setDraft, ...overrides })} />
	);
}

/** Replaces window.confirm for one call, and reports whether it was asked. */
function withConfirm<T>(
	answer: boolean,
	fn: () => T,
): { asked: string | null } {
	const original = window.confirm;
	let asked: string | null = null;
	window.confirm = (message?: string) => {
		asked = message ?? "";
		return answer;
	};
	try {
		fn();
	} finally {
		window.confirm = original;
	}
	return { asked };
}

describe("SettingsForm", () => {
	test("says where the file is and who owns it", () => {
		render(<SettingsForm {...props()} />);
		expect(screen.getByText("/home/dana/.notam/config.yaml")).toBeDefined();
		expect(screen.getByText(/NOTAM owns this file/)).toBeDefined();
	});

	test("offers the token variable's name, and never a box for the token", () => {
		render(<SettingsForm {...props()} />);
		select("github");
		expect(screen.getByDisplayValue("NOTAM_GITHUB_TOKEN")).toBeDefined();
		expect(screen.queryAllByRole("textbox", { name: /^token$/i })).toHaveLength(
			0,
		);
		expect(document.querySelectorAll('input[type="password"]')).toHaveLength(0);
	});

	test("reports a token variable that is set", () => {
		render(<SettingsForm {...props()} />);
		select("github");
		expect(screen.getByText("NOTAM_GITHUB_TOKEN is set.")).toBeDefined();
	});

	test("says what to do about one that is not", () => {
		render(
			<SettingsForm
				{...props({
					response: {
						...RESPONSE,
						status: {
							...RESPONSE.status,
							hosts: [
								{
									id: "github",
									token_env: "NOTAM_GITHUB_TOKEN",
									token_present: false,
								},
							],
						},
					},
				})}
			/>,
		);
		select("github");
		expect(
			screen.getByText(/is not set\. Export it and restart\./),
		).toBeDefined();
	});

	test("reports what a connection test found", () => {
		render(
			<SettingsForm
				{...props({
					testResults: {
						github: { ok: true, login: "dana", message: null },
					},
				})}
			/>,
		);
		select("github");
		expect(screen.getByText("Connected as dana.")).toBeDefined();
	});

	test("shows a rejected token's own message rather than rewriting it", () => {
		render(
			<SettingsForm
				{...props({
					testResults: {
						github: {
							ok: false,
							login: null,
							message: "https://api.github.com answered 401 Unauthorized",
						},
					},
				})}
			/>,
		);
		select("github");
		expect(
			screen.getByText("https://api.github.com answered 401 Unauthorized"),
		).toBeDefined();
	});

	test("does not let a saved repository's name be typed over", () => {
		render(<SettingsForm {...props()} />);
		// A name is identity, not a field: editing it in the document would read
		// as one repository leaving and an empty one arriving.
		expect(screen.queryByDisplayValue("acme/mono")).toBeNull();
		expect(
			screen.getByRole("button", { name: "Rename acme/mono" }),
		).toBeDefined();
	});

	test("renames through the endpoint that carries history across", () => {
		const renamed: string[] = [];
		render(
			<SettingsForm
				{...props({
					onRenameRepo: (id, name) => renamed.push(`${id}:${name}`),
				})}
			/>,
		);
		fireEvent.click(screen.getByRole("button", { name: "Rename acme/mono" }));
		fireEvent.change(screen.getByLabelText("new name for acme/mono"), {
			target: { value: "acme/monorepo" },
		});
		fireEvent.click(
			screen.getByRole("button", { name: "Save new name for acme/mono" }),
		);
		expect(renamed).toEqual(["r_1:acme/monorepo"]);
	});

	test("says what removing a repository would archive, in numbers", () => {
		let next: ConfigDocument | null = null;
		const { asked } = withConfirm(true, () => {
			render(<SettingsForm {...props({ onChange: (doc) => (next = doc) })} />);
			fireEvent.click(screen.getByRole("button", { name: "Remove acme/mono" }));
		});
		expect(asked).toContain("42 entries and 3 verified rules");
		expect(next).not.toBeNull();
	});

	test("leaves the document alone when that removal is declined", () => {
		let next: ConfigDocument | null = null;
		withConfirm(false, () => {
			render(<SettingsForm {...props({ onChange: (doc) => (next = doc) })} />);
			fireEvent.click(screen.getByRole("button", { name: "Remove acme/mono" }));
		});
		expect(next).toBeNull();
	});

	test("fixes a saved repository's host, which is half its identity", () => {
		render(<SettingsForm {...props()} />);
		// Changing it would make the row lookup miss, put the name back in play,
		// and turn Save into an archive-and-recreate that strands every rule.
		const host = screen.getByLabelText("Host") as HTMLSelectElement;
		expect(host.disabled).toBe(true);
	});

	test("leaves the host open on a repository that has no row yet", () => {
		render(
			<SettingsForm
				{...props({
					draft: {
						...DOC,
						repos: [
							...DOC.repos,
							{
								host: "github",
								name: "",
								path_globs: [],
								default_branch: "main",
								window_days: 180,
							},
						],
					},
				})}
			/>,
		);
		expect((screen.getByLabelText("Host") as HTMLSelectElement).disabled).toBe(
			true,
		);
		select("New repository");
		expect((screen.getByLabelText("Host") as HTMLSelectElement).disabled).toBe(
			false,
		);
	});

	test("says what removing a host takes with it, repositories included", () => {
		let next: ConfigDocument | null = null;
		const { asked } = withConfirm(false, () => {
			render(<SettingsForm {...props({ onChange: (doc) => (next = doc) })} />);
			select("github");
			fireEvent.click(
				screen.getByRole("button", { name: "Remove host github" }),
			);
		});
		expect(asked).toContain("1 repository");
		expect(asked).toContain("42 entries and 3 verified rules");
		expect(next).toBeNull();
	});

	test("removes a host with nothing under it without asking", () => {
		let next: ConfigDocument | null = null;
		const { asked } = withConfirm(false, () => {
			render(
				<SettingsForm
					{...props({
						onChange: (doc) => (next = doc),
						draft: { ...DOC, repos: [] },
						response: {
							...RESPONSE,
							config: { ...DOC, repos: [] },
							status: { ...RESPONSE.status, repos: [] },
						},
					})}
				/>,
			);
			fireEvent.click(
				screen.getByRole("button", { name: "Remove host github" }),
			);
		});
		expect(asked).toBeNull();
		expect(next).not.toBeNull();
	});

	test("cannot be saved until something changes", () => {
		render(<SettingsForm {...props()} />);
		expect(
			screen.getByRole("button", { name: "Save" }).hasAttribute("disabled"),
		).toBe(true);
	});

	test("can be saved once the draft differs from the file", () => {
		render(
			<SettingsForm
				{...props({ draft: { ...DOC, server: { port: 5000 } } })}
			/>,
		);
		expect(
			screen.getByRole("button", { name: "Save" }).hasAttribute("disabled"),
		).toBe(false);
	});

	test("shows the server's own words when a write is refused", () => {
		render(
			<SettingsForm
				{...props({
					draft: { ...DOC, server: { port: 5000 } },
					error: new Error("config.yaml changed on disk since it was read."),
				})}
			/>,
		);
		expect(screen.getByText(/changed on disk/)).toBeDefined();
	});

	test("says the process knobs need a restart, rather than implying they are live", () => {
		render(<SettingsForm {...props()} />);
		select("Process");
		// One note over the group, not one per heading: they are the same kind of
		// knob and the caveat is a property of all of them.
		expect(
			screen.getAllByText("Applied the next time NOTAM starts."),
		).toHaveLength(1);
		expect(screen.getByLabelText("Concurrency")).toBeDefined();
		expect(screen.getByLabelText("Port")).toBeDefined();
	});

	test("offers no archive section when nothing is archived", () => {
		render(<SettingsForm {...props()} />);
		expect(screen.queryByText("Archived")).toBeNull();
	});

	test("restores an archived repository by putting it back in the document", () => {
		let next: ConfigDocument | null = null;
		render(
			<SettingsForm
				{...props({
					onChange: (doc) => (next = doc),
					response: {
						...RESPONSE,
						status: {
							...RESPONSE.status,
							archived_repos: [
								{
									id: "r_2",
									host_id: "github",
									name: "acme/website",
									path_globs: ["site/**"],
									default_branch: "main",
									window_days: 180,
									prompt_template: null,
									archived_at: "2026-08-23T09:00:00.000Z",
									entries: 5,
									rules: 1,
									verified_rules: 0,
								},
							],
						},
					},
				})}
			/>,
		);
		expect(screen.getByText("Archived")).toBeDefined();
		select("acme/website");
		fireEvent.click(
			screen.getByRole("button", { name: "Restore acme/website" }),
		);
		expect(next).not.toBeNull();
		expect(
			(next as unknown as ConfigDocument).repos.map((r) => r.name),
		).toEqual(["acme/mono", "acme/website"]);
	});

	test("lists a repository under the host that owns it", () => {
		render(<SettingsForm {...props()} />);
		// The rail is where the host-repository relationship is stated. In the
		// document it is a foreign key; on screen it has to be visible without
		// opening anything.
		const buttons = screen.getAllByRole("button");
		const host = screen.getByRole("button", { name: "github" });
		const repo = screen.getByRole("button", { name: "acme/mono" });
		expect(buttons.indexOf(repo)).toBe(buttons.indexOf(host) + 1);
	});

	test("falls back to a pane that still exists when the selected one goes", () => {
		withConfirm(true, () => {
			render(<Stateful initial={DOC} />);
			fireEvent.click(screen.getByRole("button", { name: "Remove acme/mono" }));
		});
		// Nothing is selected any more, so the form picks again rather than
		// rendering an empty pane against an index that no longer resolves.
		expect(
			screen.queryByRole("button", { name: "Rename acme/mono" }),
		).toBeNull();
		expect(screen.getByLabelText("API base")).toBeDefined();
	});

	test("stops calling a repository archived once the draft names it again", () => {
		const archived = {
			id: "r_2",
			host_id: "github",
			name: "acme/website",
			path_globs: ["site/**"],
			default_branch: "main",
			window_days: 180,
			prompt_template: null,
			archived_at: "2026-08-23T09:00:00.000Z",
			entries: 5,
			rules: 1,
			verified_rules: 0,
		};
		render(
			<Stateful
				initial={DOC}
				overrides={{
					response: {
						...RESPONSE,
						status: { ...RESPONSE.status, archived_repos: [archived] },
					},
				}}
			/>,
		);
		select("acme/website");
		fireEvent.click(
			screen.getByRole("button", { name: "Restore acme/website" }),
		);
		// Restoring puts it in the document before the save that clears the
		// stamp. Listed in both places it would be two rail items under one
		// name, and the name is how anything reaches it.
		expect(screen.queryByText("Archived")).toBeNull();
		expect(
			screen.getAllByRole("button", { name: "acme/website" }),
		).toHaveLength(1);
	});

	test("confirms before destroying an archived repository for good", () => {
		const deleted: string[] = [];
		const { asked } = withConfirm(true, () => {
			render(
				<SettingsForm
					{...props({
						onDeleteRepo: (id) => deleted.push(id),
						response: {
							...RESPONSE,
							status: {
								...RESPONSE.status,
								archived_repos: [
									{
										id: "r_2",
										host_id: "github",
										name: "acme/website",
										path_globs: [],
										default_branch: "main",
										window_days: 180,
										prompt_template: null,
										archived_at: "2026-08-23T09:00:00.000Z",
										entries: 5,
										rules: 1,
										verified_rules: 1,
									},
								],
							},
						},
					})}
				/>,
			);
			select("acme/website");
			fireEvent.click(
				screen.getByRole("button", {
					name: "Delete acme/website permanently",
				}),
			);
		});
		expect(asked).toContain("cannot be undone");
		expect(deleted).toEqual(["r_2"]);
	});
});
