---
"notam": patch
---

The interface is a console, and every overlay is one window in the middle.

NOTAM is a local tool, driven from a terminal, that reads and writes files a
terminal shows you. The web UI now says so: one monospaced family end to end,
square corners, a visible grid, micro-labels in tracked capitals, and a chrome
band top and bottom that holds the dark ink in both themes — so the boundary
between the tool and what the tool is showing you needs no rule to be legible.
The status line at the foot carries the address this process answers on and the
build it is, which is the question you ask when two of them are open.

Amber is the accent and it is a fill, not only an ink: there is one filled
control on a screen, so finding the thing that acts costs no reading. It sits
over a hundred degrees from `--ok` and `--alert`, which is what keeps a status
column legible beside an accented one. `--warn` is the accent's own hue on
purpose — attention and interaction are one signal level here, and every
surface that takes it is a bordered notice, a banner, or a glyph with its
sentence beside it, never a bare tint in a column of accented things.

A rule's type is a bracketed tag, its status a bracketed token with no box at
all, the way a log line reports state. Confidence gets a bar beside the digits
rather than only a decimal to decode, and weak confidence dims the bar instead
of recolouring it — the number never moves, so hue is a second reading of a
value already stated and never the only thing carrying it.

The entry and rule surfaces stop being drawers pinned to the right edge. They
are the same centred window every dialog already was, because two overlay
geometries in one app read as one of them having missed, and the reader has no
way to tell which was meant. `Drawer` is `Panel` accordingly.

That window now keeps the promise `aria-modal` makes. Focus moves into it on
open, Tab cannot leave it, and the control that opened it gets focus back when
it closes; previously focus sat on a button behind the scrim and the first
Shift+Tab walked into the table. Clicking beside a window dismisses it, which
is what everyone tries first — but only when both the press and the release
land outside, so selecting text in a dialog and releasing past its edge no
longer throws away what you were in the middle of. Settings is the deliberate
exception: it holds unsaved edits, so Escape and Close are the only ways out.

The tab strip is a real tablist rather than three buttons wearing the role. The
run is one tab stop, the arrows move within it, Home and End reach its ends,
and the panel below is a tabpanel labelled by whichever tab is live. A tablist
that leaves three separate stops in the sequence is worse than the plain
buttons it replaced, because a screen reader announces arrows that do nothing.

The truncated-file-count marker is an icon with its sentence beside it instead
of a bare warning sign whose meaning lived only in a tooltip, and a table
loading its rows says `aria-busy` rather than announcing nothing at all.
