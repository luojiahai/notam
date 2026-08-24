import { describe, expect, test } from "bun:test";
import { extractReleaseNotes, parseArgs } from "../../scripts/release-notes.ts";

const CHANGELOG = `# notam

## 0.2.0

### Minor Changes

- [#14](https://github.com/luojiahai/notam/pull/14) Thanks [@luojiahai](https://github.com/luojiahai)! - Repo-level actions

## 0.1.1

### Patch Changes

- [#13](https://github.com/luojiahai/notam/pull/13) Thanks [@luojiahai](https://github.com/luojiahai)! - Adopt changesets

## 0.1.0

### Minor Changes

- First release
`;

describe("extractReleaseNotes", () => {
	test("returns one section's body without its heading", () => {
		expect(extractReleaseNotes(CHANGELOG, "0.1.1")).toBe(
			"### Patch Changes\n\n- [#13](https://github.com/luojiahai/notam/pull/13) Thanks [@luojiahai](https://github.com/luojiahai)! - Adopt changesets\n",
		);
	});

	test("stops at the next release and never swallows the one below", () => {
		const notes = extractReleaseNotes(CHANGELOG, "0.2.0");
		expect(notes).toContain("Repo-level actions");
		expect(notes).not.toContain("Adopt changesets");
		expect(notes).not.toContain("## 0.1.1");
	});

	test("reads the last section to the end of the file", () => {
		expect(extractReleaseNotes(CHANGELOG, "0.1.0")).toBe(
			"### Minor Changes\n\n- First release\n",
		);
	});

	test("accepts the tag form as well as the bare version", () => {
		expect(extractReleaseNotes(CHANGELOG, "v0.1.1")).toBe(
			extractReleaseNotes(CHANGELOG, "0.1.1"),
		);
	});

	test("keeps a heading that only appears inside a fenced block", () => {
		const changelog = [
			"# notam",
			"",
			"## 0.3.0",
			"",
			"### Patch Changes",
			"",
			"- Documents the changelog format:",
			"",
			"  ```md",
			"  ## 0.1.0",
			"  ```",
			"",
			"## 0.2.0",
			"",
			"### Minor Changes",
			"",
			"- Older",
			"",
		].join("\n");

		const notes = extractReleaseNotes(changelog, "0.3.0");
		expect(notes).toContain("## 0.1.0");
		expect(notes).not.toContain("Older");
		// The fenced `## 0.1.0` is a code sample, not a release that can be cut.
		expect(() => extractReleaseNotes(changelog, "0.1.0")).toThrow(
			'No "## 0.1.0" section',
		);
	});

	test("refuses a version the changelog does not carry", () => {
		expect(() => extractReleaseNotes(CHANGELOG, "9.9.9")).toThrow(
			'No "## 9.9.9" section',
		);
	});

	test("refuses a section with nothing in it rather than an empty release", () => {
		expect(() =>
			extractReleaseNotes("# notam\n\n## 0.1.0\n\n", "0.1.0"),
		).toThrow("is empty");
	});

	test("refuses a version prefix that is not the whole heading", () => {
		expect(() => extractReleaseNotes(CHANGELOG, "0.1")).toThrow(
			'No "## 0.1" section',
		);
	});
});

describe("parseArgs", () => {
	test("defaults to CHANGELOG.md", () => {
		expect(parseArgs(["--version", "0.1.1"])).toEqual({
			version: "0.1.1",
			file: "CHANGELOG.md",
		});
	});

	test("takes another file", () => {
		expect(
			parseArgs(["--version", "0.1.1", "--file", "docs/CHANGELOG.md"]),
		).toEqual({ version: "0.1.1", file: "docs/CHANGELOG.md" });
	});

	test("requires a version", () => {
		expect(() => parseArgs([])).toThrow("--version is required");
	});

	test("refuses a flag used as a value", () => {
		expect(() => parseArgs(["--version", "--file"])).toThrow(
			"--version needs a value",
		);
	});

	test("refuses an unknown flag", () => {
		expect(() => parseArgs(["--nope"])).toThrow('Unknown flag "--nope"');
	});
});
