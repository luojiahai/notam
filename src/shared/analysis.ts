import { z } from "zod";
import { isAnalysableRuleType, type RuleType } from "./rule-types.ts";

/**
 * The analyser's output contract. This schema is deliberately NOT overridable
 * by a repository's prompt_template: the UI renders exactly this shape, so a
 * tuned prompt can change what the analyser looks for but never what it returns.
 *
 * Lives in shared/ because the web client validates the same payload.
 */
export const AnalysedRuleSchema = z.object({
	/**
	 * Anything outside the seven the prompt offers becomes `other` rather than
	 * failing the parse: one unrecognised label would otherwise discard every
	 * valid rule in the same reply, because an entry's rules are inserted in a
	 * single transaction. A non-string still fails — that is a broken reply, not
	 * a misjudged classification.
	 *
	 * Coercing here rather than after a repair attempt also keeps `other` out of
	 * every validator error, and so out of every prompt the model ever sees.
	 */
	type: z
		.string()
		.transform<RuleType>((value) =>
			isAnalysableRuleType(value) ? value : "other",
		),
	directive: z
		.string()
		.min(1)
		.max(300)
		// One-line imperative. A model that returns a paragraph has misunderstood
		// the contract, and the repair retry exists to tell it so.
		.refine((value) => !value.includes("\n"), {
			message: "directive must be a single line",
		}),
	rationale: z.string().min(1),
	scope_globs: z.array(z.string()).default([]),
	confidence: z.number().min(0).max(1),
	source_comment_urls: z.array(z.string()).default([]),
});

export const AnalysedRulesSchema = z.array(AnalysedRuleSchema);

export type AnalysedRule = z.output<typeof AnalysedRuleSchema>;
