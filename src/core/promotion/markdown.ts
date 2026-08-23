import type { RuleRow } from "../../shared/types.ts";

export const RULES_DIR = ".claude/rules";

export function rulePath(slug: string): string {
	return `${RULES_DIR}/${slug}.md`;
}

/**
 * Double-quoted YAML. Globs start with `*` and contain `[`, `{`, and `:` often
 * enough that leaving them bare would eventually produce a file the team's own
 * tooling cannot parse. `scope_globs` is an unconstrained `z.array(z.string())`
 * (src/shared/analysis.ts), so a model-authored glob can contain a raw newline,
 * carriage return, or tab; escaping backslashes first — before introducing any
 * new backslashes of our own — keeps this order-safe against double-escaping.
 */
function yamlString(value: string): string {
	return `"${value
		.replace(/\\/g, "\\\\")
		.replace(/"/g, '\\"')
		.replace(/\n/g, "\\n")
		.replace(/\r/g, "\\r")
		.replace(/\t/g, "\\t")}"`;
}

function yamlScope(globs: string[]): string {
	if (globs.length === 0) return "scope: []";
	return `scope:\n${globs.map((glob) => `  - ${yamlString(glob)}`).join("\n")}`;
}

/**
 * Spec section 7's file format. `notam: true` is the marker that lets a
 * repository tell NOTAM-authored rules from hand-written ones.
 */
export function renderRuleFile(rule: RuleRow, sourceUrl: string): string {
	return `---
id: ${rule.id}
kind: ${rule.kind}
${yamlScope(rule.scope_globs)}
source: ${yamlString(sourceUrl)}
notam: true
---

${rule.directive.trim()}

${rule.rationale.trim()}
`;
}

export function promotionTitle(count: number): string {
	return `Add ${count} NOTAM rule${count === 1 ? "" : "s"}`;
}

export type PRBodyItem = {
	rule: RuleRow;
	path: string;
	sourceUrl: string;
	sourceNumber: number;
};

/** Every rule links back to the review conversation it came from, so a reviewer can trace it. */
export function renderPRBody(items: PRBodyItem[]): string {
	const lines = items.map(
		(item) =>
			`- **${item.rule.kind === "do" ? "DO" : "DON'T"}** ${item.rule.directive} ` +
			`— \`${item.path}\` — from [#${item.sourceNumber}](${item.sourceUrl})`,
	);
	return `NOTAM extracted these rules from merged pull request reviews in this repository.

${lines.join("\n")}

Each file is a single rule under \`${RULES_DIR}/\`. Merge to adopt them; close to reject them.
`;
}
