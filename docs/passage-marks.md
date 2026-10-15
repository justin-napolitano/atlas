# Private passage marks

Reader stories #93/#94 reuse captured annotations rather than storing a second
set of detached highlights. `mark_style` is `highlight`, `underline`, or `none`.
It controls presentation only, separately from capture kind, reading progress,
scholarly review, interpretation, and publication.

Creation defaults to `highlight` for existing clients. Updates may send a style
with the note body and expected revision; omitted/null style preserves the
current value. The existing revision trigger retains changes to both together.
A repeated update after a lost response returns the same revision only when
body, explicit style, actor and expected successor match. Other stale writes
return the current owner-visible annotation for explicit reconciliation.

Migration 0011 adds the bounded column without rewriting historical snapshots.
Older snapshots without a style are displayed as the legacy highlight default;
they must not be represented as originally containing a recorded style choice.
The existing immutable source/version/code-point selector remains unchanged.
Private JSON-LD export includes `ir:markStyle`; Ossie declares the presentation
field as metadata, not a confidence/quality/ranking feature.

Runtime owners receive only explicit insert/update column grants; publisher
roles still cannot read private annotations. Styles never imply public consent.
The new reader interface is delivered separately and must prove reload,
overlap, note-to-passage return, keyboard/mobile and real saved-state behavior.
