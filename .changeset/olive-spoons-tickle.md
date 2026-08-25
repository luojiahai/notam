---
"notam": patch
---

A failed analysis no longer prints its error into the entries row. The stored message is `claude`'s own output, of unbounded length, and a row that grew to fit it stopped reading as a row. The Failed pill is now a button that opens the entry drawer, where that text already sits — and it sits there as a trace: monospace, its line breaks kept, scrolled past a few lines rather than growing without limit. Row action cells also take the row's full height again, so their separator lines meet the ones beside them on any row taller than a single line.
