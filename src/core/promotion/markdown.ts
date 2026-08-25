import {
	RULE_TYPE_LABELS,
	RULE_TYPES,
	type RuleType,
} from "../../shared/rule-types.ts";
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

/**
 * `paths` is the frontmatter key Claude Code reads: a rule carrying it loads
 * only when Claude opens a matching file, and a rule without it loads at launch
 * and applies everywhere. An unscoped rule therefore has to omit the key
 * entirely — an empty list is a list that matches nothing, which would keep the
 * rule out of context altogether.
 */
function frontmatter(rule: RuleRow, sourceUrl: string): string {
	const lines = [`id: ${rule.id}`, `type: ${rule.type}`];
	if (rule.scope_globs.length > 0) {
		lines.push("paths:");
		for (const glob of rule.scope_globs) lines.push(`  - ${yamlString(glob)}`);
	}
	lines.push(`source: ${yamlString(sourceUrl)}`, "notam: true");
	return lines.join("\n");
}

/**
 * The rule file format. `notam: true` is the marker that lets a
 * repository tell NOTAM-authored rules from hand-written ones. `id` and `type`
 * are unrecognised keys that Claude Code ignores; they are there for NOTAM and
 * for whoever reads the diff.
 */
export function renderRuleFile(rule: RuleRow, sourceUrl: string): string {
	return `---
${frontmatter(rule, sourceUrl)}
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

function bullet(item: PRBodyItem): string {
	return (
		`- ${item.rule.directive} ` +
		`— \`${item.path}\` — from [#${item.sourceNumber}](${item.sourceUrl})`
	);
}

/**
 * Grouped by type, because a reviewer opening a promotion of twenty rules reads
 * them a category at a time. Every rule links back to the review conversation it
 * came from, so a reviewer can trace it.
 */
export function renderPRBody(items: PRBodyItem[]): string {
	const byType = new Map<RuleType, PRBodyItem[]>();
	for (const item of items) {
		const group = byType.get(item.rule.type);
		if (group) group.push(item);
		else byType.set(item.rule.type, [item]);
	}

	const sections = RULE_TYPES.flatMap((type) => {
		const group = byType.get(type);
		if (group === undefined) return [];
		return [`### ${RULE_TYPE_LABELS[type]}\n\n${group.map(bullet).join("\n")}`];
	});

	return `NOTAM extracted these rules from merged pull request reviews in this repository.

${sections.join("\n\n")}

Each file is a single rule under \`${RULES_DIR}/\`. Merge to adopt them; close to reject them.
`;
}
