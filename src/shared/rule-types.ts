/**
 * A rule's subject matter, and the one place the vocabulary is written down.
 * The analyser classifies into it, the file it promotes carries it, and the
 * rules table renders it, so a member added here is a member everywhere.
 */

/**
 * What the analyser may choose from. `other` is deliberately absent: an escape
 * hatch offered to a classifier becomes its default answer, and then most rules
 * are unclassified and the field stops discriminating.
 */
export const ANALYSABLE_RULE_TYPES = [
	"architecture",
	"code-style",
	"documentation",
	"performance",
	"security",
	"testing",
	"workflow",
] as const;

export type AnalysableRuleType = (typeof ANALYSABLE_RULE_TYPES)[number];

/**
 * Everything a stored rule can be. `other` is reachable only by coercion in
 * shared/analysis.ts and by the column default — never by the model, which is
 * why it appears in no prompt and in no validator error.
 * It is the bucket that says the vocabulary is missing a member: a repository
 * accumulating `other` rules is telling you which one to add next.
 *
 * Alphabetical, and used as the iteration order wherever types are grouped. A
 * curated order would have to be re-argued every time a member is added.
 */
export const RULE_TYPES = [
	"architecture",
	"code-style",
	"documentation",
	"other",
	"performance",
	"security",
	"testing",
	"workflow",
] as const;

export type RuleType = (typeof RULE_TYPES)[number];

/** True only when A and B are the same union, in both directions. */
type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;

/**
 * Compile-time proof that the two lists stay in step: everything a rule can be
 * is something the analyser may choose, plus `other`. Adding a member to one
 * list and not the other is a type error here rather than a member with no
 * definition and no place in the prompt. Exported only so `noUnusedLocals` does
 * not delete the guard.
 */
export const PINNED_RULE_TYPES: Exact<RuleType, AnalysableRuleType | "other"> =
	true;

export function isAnalysableRuleType(
	value: string,
): value is AnalysableRuleType {
	return (ANALYSABLE_RULE_TYPES as readonly string[]).includes(value);
}

/**
 * Spelled out for the model, because the failure mode of bare slugs is a silent
 * drift where every rule lands in one bucket. Keyed by the analysable members
 * alone, so a member added without a definition is a compile error rather than
 * a gap in the prompt.
 */
export const RULE_TYPE_DEFINITIONS: Record<
	Exclude<RuleType, "other">,
	string
> = {
	architecture:
		"layering, module boundaries, dependency direction, and where code lives",
	"code-style": "naming, formatting, and language idiom",
	documentation: "comments, docstrings, and changelogs",
	performance: "allocations, query patterns, and caching",
	security:
		"authentication, authorisation, secrets, input validation, and data exposure",
	testing: "what to test and how",
	workflow:
		"the agreements about making the change itself — changesets, migrations, feature flags, commit hygiene",
};

/**
 * The prose form, for a heading in a promotion pull request and for a panel
 * that has room for it. The table badge shows the slug instead: these do not
 * fit a column you scan down.
 */
export const RULE_TYPE_LABELS: Record<RuleType, string> = {
	architecture: "Architecture guidelines",
	"code-style": "Code style guidelines",
	documentation: "Documentation conventions",
	other: "Other",
	performance: "Performance requirements",
	security: "Security requirements",
	testing: "Testing conventions",
	workflow: "Workflow conventions",
};
