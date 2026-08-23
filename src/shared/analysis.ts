import { z } from "zod";

/**
 * Spec section 6's output contract. This schema is deliberately NOT overridable
 * by a repository's prompt_template: the UI renders exactly this shape, so a
 * tuned prompt can change what the analyser looks for but never what it returns.
 *
 * Lives in shared/ because plan 3's web client validates the same payload.
 */
export const AnalysedRuleSchema = z.object({
	kind: z.enum(["do", "dont"]),
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
