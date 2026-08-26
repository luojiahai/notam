---
"notam": patch
---

Rebuild the web UI around the rule pipeline.

Entries, rules and promotions were three peer tabs, which said they were three
comparable things. They are not: an entry is the merged pull request a rule was
cut from, and a promotion is the pull request a rule is riding in. The tabs are
replaced by a stage bar — Sources → Draft → In review → Adopted, with Set aside
off the end of the run — that carries each stage's count, so the same control
that moves you also says where the work has piled up.

Promotions are no longer a destination. Open ones head the rules they carry on
the In review stage, and settled ones fold into a list underneath. Adopted rules
are set as the brief they become in the repository rather than as another grid,
because that stage's contents are the only ones that leave NOTAM.

The chrome is rebuilt with them: a dark brand band in both themes with a beacon
mark, an indigo accent used as a fill rather than only as an ink, a seven-step
type scale every size in the app now comes from, a confidence meter in place of
a bare number, per-row controls that rest until the pointer or the keyboard
arrives, and a strip that appears only while an analysis is actually running.
The stage bar is a real tablist: one tab stop, arrows within it, Home and End to
its ends.
