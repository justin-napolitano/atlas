# Free margin writing

Issue #154 adds private organizational notes at an approximate reading position,
without a selected quotation. The existing notebook remains the authority.
`reading_position` is a zero-based Unicode code-point offset in an immutable
reading document. It requires the original project, source and document, forbids
an annotation ID, and cannot turn a personal note into an exact source claim.

Migration 0019 validates bounds and immutable identity in PostgreSQL. Creation
replay hashes include the point only when supplied, preserving old requests.
Recovery copies retain the point and historical baseline. The owner can insert
the column but cannot update it. Anonymous/public projections do not expose notes.

API and column-grant changes require human/AppSec review under the repository's
applied Citizen Developer policy before a hosted release. Existing IAP, origin,
write-header, private no-store and publication boundaries remain applicable.

## Reader interaction

Click the empty margin and type. The initial location is captured once; moving
through the text does not relocate that thought. Notes save after 800 ms of quiet,
or at most five seconds during continuous typing, and flush when leaving the
editor. Typing remains enabled during requests. A saved note is directly editable;
leaving it reveals the next blank margin. Alt+N without a selection focuses the
margin; a selection still uses exact quotation annotation.

The actual notebook writer serializes CAS revisions and freezes failed requests
for exact retries. "Saved" means the actual notebook entry was confirmed, not
merely that a recovery copy exists. Errors retain text and show Retry; conflicts
retain both versions for comparison in Notes. A separate private recovery copy
protects unfinished writing. Source and edition IDs plus a code-point position
are exported with Markdown; return links reopen that immutable edition and point.

Verification: the margin browser harness exercises typing without selection or
Save, automatic correction, loss of page memory, typing during a pending request,
conflicts, and mobile width. Unit checks cover lost create/edit acknowledgements,
Unicode bounds, response relocation, and source-specific warm-tab protection.

## Markdown sidebar and source navigation

Issue #156 replaces permanent saved-note textareas with rendered CommonMark/GFM.
Click a note's body or focus it and press Enter to write in place. Leaving the
note or pressing Escape returns to the formatted view; autosave and recovery keep
using the existing notebook authority. The writing line sits below notes, and
secondary actions stay quiet until hover/focus (visible on touch devices).

Headings, emphasis, lists/tasks, tables, fenced code, links, strikethrough, and
footnotes render through the same NotebookMarkdown component as Notes. Footnote
identities are scoped per component. Raw HTML and unsafe URLs remain inert;
external images load only after an explicit click. Notebook links resolve against
a bounded project projection, and passage links are verified before navigation.

Clicking a saved exact highlight reveals its passage note in the sidebar rather
than opening its editing form. Existing overlapping marks still cycle and retain
their exact original selectors. Freeform notes have separate location buttons in
the source gutter. These markers are siblings of the immutable source text, so
they cannot change quotation offsets, copied text, or source hash verification.

The compiled margin browser check covers formatted Markdown, keyboard/click
editing, automatic saves, reload, conflicts, Trash/Undo, source markers and exact
highlight navigation, unchanged source text, unsafe-link/HTML handling and mobile
width. The existing workspace browser check verifies overlap and backlink focus.
