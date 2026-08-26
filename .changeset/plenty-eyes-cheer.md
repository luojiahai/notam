---
"notam": patch
---

Settings is a centred window with a rail, and the header control is a gear.

The header's Settings button loses its label. It is a glyph now, beside the
GitHub mark that already worked that way, under the rule the header follows:
a control that takes you somewhere or toggles chrome carries an icon and an
accessible name, and a control that acts on what you are looking at keeps its
label. The theme control is neither, so it keeps its three words — it shows
which of three modes is live, and no single glyph says that.

Settings itself stops being a drawer. Hosts, their repositories, whatever is
archived, and the process knobs are listed down the left; whichever you pick
is edited on the right. The relationship the document holds as a foreign key
is visible without opening anything: a repository sits under the host that
owns it, and its count sits beside the host's name. Only one entity's fields
are on screen, so the window is the same height whether you have configured
one repository or twenty.

That is what earns it the centred geometry a drawer pinned to one edge cannot
give: a split wants width and height together. Save and Discard are pinned to
the bottom edge, because the rail and the pane scroll independently and an
action inside either could be scrolled away from a change made in the other.
Escape closes the window; clicking beside it does not, so a stray click cannot
throw away unsaved edits.

Analysis and Server merge into one Process pane, stating once that its knobs
apply at the next start instead of once per heading. Restoring something
archived now moves the pane to what was restored rather than leaving a Restore
button for a row the document already names. The empty state a first run meets
offers "Configure a repository", which is what that path is for.
