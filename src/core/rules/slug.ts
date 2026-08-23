/** Long enough to stay readable in a file listing, short enough not to hit path limits. */
export const MAX_SLUG_LENGTH = 60;

/**
 * The base file name for a rule, derived from its directive at creation time
 * and then stored. Deliberately ASCII-only and lossy: this is a file name a
 * reviewer skims in a PR diff, not an identifier anything resolves by.
 */
export function slugify(text: string): string {
	const kebab = text
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
	if (kebab === "") return "rule";
	if (kebab.length <= MAX_SLUG_LENGTH) return kebab;

	const cut = kebab.slice(0, MAX_SLUG_LENGTH);
	const lastSeparator = cut.lastIndexOf("-");
	// Prefer a word boundary, but never truncate to nothing.
	const trimmed = lastSeparator > 0 ? cut.slice(0, lastSeparator) : cut;
	return trimmed.replace(/-+$/, "") || "rule";
}

export type SlugAssignment = {
	slug: string;
	/**
	 * `"base-branch"` means a file with this base slug already exists on the
	 * target branch — the case spec section 7 requires the confirmation dialog to
	 * name. `"batch"` means two rules in this same selection wanted the same
	 * name. `null` means it was free.
	 */
	collided: "base-branch" | "batch" | null;
};

/**
 * Assigns a final file name to each base slug, suffixing `-2`, `-3`, ... against
 * both the files already on the base branch and the earlier rules in this batch.
 * Suffixes are never written back to the rule row: the stored `file_slug` stays
 * the stable base, so re-promoting the same rule does not drift.
 */
export function resolveSlugs(
	bases: string[],
	taken: Iterable<string>,
): SlugAssignment[] {
	const onBranch = new Set<string>();
	for (const name of taken) {
		onBranch.add(name.endsWith(".md") ? name.slice(0, -3) : name);
	}
	const used = new Set(onBranch);

	return bases.map((base) => {
		const collided: SlugAssignment["collided"] = onBranch.has(base)
			? "base-branch"
			: used.has(base)
				? "batch"
				: null;
		let candidate = base;
		let counter = 1;
		while (used.has(candidate)) {
			counter++;
			candidate = `${base}-${counter}`;
		}
		used.add(candidate);
		return { slug: candidate, collided };
	});
}
