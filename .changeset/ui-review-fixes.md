---
"notam": patch
---

fix(web): the tables hold still while you type, and closing Settings asks before it costs you anything.

Filtering a table no longer flashes it to a skeleton. Every keystroke is a new
query, and with nothing held the rows were being replaced by loading bars one
character at a time — so the surface you were reading to decide what to type
next was the surface that kept disappearing. The entries and rules tables now
keep the previous result on screen while the next one loads. Switching
repositories still starts empty, which is right: those rows are about something
else.

Settings asks before discarding staged edits. The form stages the whole document
and reaches `config.yaml` only on Save, so closing a clean window costs nothing
and is left alone. A window with unsaved changes is the one case where closing
destroys something the file has never seen, so it now asks first. The removal
and permanent-deletion confirmations move to the same window every other overlay
in the app already uses, instead of the browser's own confirm box, which takes
no styling, holds no focus trap, and stops the page while it waits.

Three contrast repairs. A chip's count separates from its label by weight rather
than transparency, because a 0.75 alpha over the tint of an active chip fell
below AA. Faint text in the light theme darkens enough to clear the same bar. An
excluded file in a promotion plan dims only its body: the head carries the
checkbox that puts the file back, and dimming a control is dimming the way out.

The bulk-selection checkboxes are 14 pixels square, which is a smaller thing
than a pointer is expected to hit. Each one now sits in a padded label that
takes the press, pulled back out of the layout so rows keep the height they had.

A numeric field in Settings can be emptied. Clearing one used to snap the draft
to a literal zero before you had typed the number you were reaching for, and a
concurrency of 0 is not a value anyone chose. The box holds whatever you type,
commits only a number that parses, and on blur falls back to the last one that
did.

Two failures with the same message are one banner. The warning list is keyed by
its own text, so identical failures from separate requests collided on the key
and counted twice in the status line.
