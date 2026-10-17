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
