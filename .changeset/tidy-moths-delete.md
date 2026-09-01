---
"notam": patch
---

Abandoned rules can be deleted for good.

Select rules that have all been abandoned and the rules table offers Delete,
behind a confirmation naming how many are going. Nothing else can be deleted:
abandoning is one decision and destroying is a second one, taken on something
already parked, the same shape removing a host or repository already has.

The batch is all or nothing. A selection holding a rule that is still draft,
proposed, or verified is refused whole and nothing goes, and so is one naming
an id that is not there.

Nothing is kept behind: no tombstone and no audit row. A rules pull request
whose rules are all deleted keeps its own row and its link, because the pull
request was opened on GitHub whatever became of what went into it.
