import type { z } from "zod";

/**
 * Renders zod issues as `hosts[0].api_base: Invalid URL`, one indented line
 * each. Shared by config validation and analyser-output validation: the
 * analyser's repair retry sends this text straight back to the model, so the
 * two must render identically or the two error surfaces drift.
 */
export function formatZodError(error: z.ZodError): string {
	return error.issues
		.map((issue) => {
			const path = issue.path.reduce<string>(
				(acc, segment) =>
					typeof segment === "number"
						? `${acc}[${segment}]`
						: acc
							? `${acc}.${String(segment)}`
							: String(segment),
				"",
			);
			return `  ${path || "(root)"}: ${issue.message}`;
		})
		.join("\n");
}
