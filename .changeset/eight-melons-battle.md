---
"notam": patch
---

A rule now carries its subject matter instead of a do/don't polarity. The
analyser classifies each rule as `architecture`, `code-style`, `documentation`,
`performance`, `security`, `testing`, or `workflow`, and a directive states its
own prohibition rather than leaning on a badge to supply the negation. Anything
the model returns outside those seven is stored as `other`, so one unrecognised
label no longer discards every valid rule extracted from the same pull request.

Promoted rule files scope themselves correctly. The frontmatter key for a rule's
globs is `paths`, which is the key Claude Code reads, and an unscoped rule omits
it entirely so it loads at launch rather than matching nothing. The promotion
pull request groups its rules under their type.
