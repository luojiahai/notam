#!/usr/bin/env bun
/**
 * Prints one version's section of `CHANGELOG.md`, which is what the release
 * workflow hands to `gh release create --notes-file`.
 *
 *   bun run scripts/release-notes.ts --version 0.1.1
 *
 * The changelog is written by `changeset version`, so the shape is fixed: an
 * `# notam` title, then one `## <version>` section per release, newest first.
 */
import { readFile } from "node:fs/promises";

const CHANGELOG = "CHANGELOG.md";

/** Matches a release heading — `## 0.1.1` — and never `### Patch Changes`. */
const RELEASE_HEADING = /^##[^#]/;

/**
 * The line index of every release heading, in order.
 *
 * A summary may contain a fenced block, and a fenced block may contain a line
 * that looks exactly like a release heading. Tracking the fences is what keeps
 * a changelog entry about Markdown from splitting the section it is written in.
 */
function releaseHeadings(lines: string[]): number[] {
	const headings: number[] = [];
	let fenced = false;
	for (let index = 0; index < lines.length; index++) {
		const line = lines[index] ?? "";
		if (line.trimStart().startsWith("```")) fenced = !fenced;
		else if (!fenced && RELEASE_HEADING.test(line)) headings.push(index);
	}
	return headings;
}

export function extractReleaseNotes(markdown: string, version: string): string {
	// Both `0.1.1` and `v0.1.1` name the same release; the headings carry the
	// bare version and the git tags carry the `v`.
	const wanted = version.startsWith("v") ? version.slice(1) : version;
	const lines = markdown.split("\n");
	const headings = releaseHeadings(lines);
	const at = headings.findIndex(
		(index) => (lines[index] ?? "").slice(2).trim() === wanted,
	);
	if (at === -1) {
		throw new Error(`No "## ${wanted}" section in the changelog`);
	}

	// The section runs to the next release, or to the end for the oldest one.
	const start = headings[at] ?? 0;
	const end = headings[at + 1] ?? lines.length;

	const body = lines
		.slice(start + 1, end)
		.join("\n")
		.trim();
	if (body === "") {
		throw new Error(`The "## ${wanted}" section of the changelog is empty`);
	}
	return `${body}\n`;
}

export function parseArgs(argv: string[]): { version: string } {
	let version: string | undefined;

	for (let index = 0; index < argv.length; index++) {
		const flag = argv[index];
		if (flag === undefined) continue;
		const value = (): string => {
			const next = argv[++index];
			if (next === undefined || next.startsWith("--")) {
				throw new Error(`${flag} needs a value`);
			}
			return next;
		};
		switch (flag) {
			case "--version":
				version = value();
				break;
			default:
				throw new Error(`Unknown flag "${flag}"`);
		}
	}

	if (version === undefined) throw new Error("--version is required");
	return { version };
}

if (import.meta.main) {
	try {
		const { version } = parseArgs(Bun.argv.slice(2));
		process.stdout.write(
			extractReleaseNotes(await readFile(CHANGELOG, "utf8"), version),
		);
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	}
}
