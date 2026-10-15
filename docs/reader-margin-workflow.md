# Reading with marks and margin notes

This owner-only reading slice implements part of #85/#93. It uses the existing
PostgreSQL reading-document and exact annotation contracts, including the
revisioned `mark_style` addition in `docs/passage-marks.md`.

## Read, mark, write, return

Open a source and choose an identified saved excerpt. Select a word, clause or
passage, then choose **Annotate selected text**, **Underline**, or **Margin note**.
Write directly beside the source, and save with the button or Command/Control +
Enter. Keyboard users can select text in the source and use Alt + N to open a
margin-only note. A mark can have an empty note; it remains an exact saved anchor.

All loaded saved annotations appear in the source. Overlapping passages split
into non-overlapping text runs; each run retains all note IDs, and activating it
cycles the associated notes. A saved mark opens its margin editor. A note's
quotation returns keyboard focus to the exact source passage; its ordinary link
also supports opening the passage in another tab. Source text is rendered as text,
never injected HTML. Rendering does not change Unicode text, normalization,
edition, quotation or immutable positions.

The margin can be resized with a pointer or keyboard separator, or hidden to
read quietly. Selecting a new passage or opening a saved mark reopens it.
**Focus on reading** expands the reading desk by hiding the record list;
**Show library** brings it back. Narrow layouts stack notes below the text.
Device-local pane widths are layout preferences only, with no source or note
content in local storage.

The address records only stable project/source/document/annotation IDs. Choosing
a saved reading version replaces the document bookmark and clears an old
annotation bookmark. The new `initialDocumentId` reader prop and fourth
`open(recordId, projectId, annotationId, documentId)` workspace argument let source
intake open the exact newly created excerpt.

## Saved state, failures and limits

Annotations remain private and captured/unreviewed. Highlight, underline and
margin-only are presentation choices, not scholarly confidence or approval.
Saving an edited note and its mark style uses one expected revision; a different
cloud body or style requires an explicit conflict choice. Source selectors stay
immutable. Invalid/stale selectors are not silently moved to another occurrence.

An unconfirmed create retains its original UUID and exact payload. The composer
locks until that original request is retried or explicitly discarded, preventing
a changed note from reusing a possibly committed ID. A known initial validation
rejection remains editable. Discarding an uncertain local draft does not delete a
possibly committed cloud annotation; refresh saved notes to inspect it.

Drafts survive source/record navigation within the current page and trigger the
existing unload warning. They are **not durable across reload or devices**. Saved
notes and exact bookmarked passages reload from the authenticated backend. This
is not the full #94 durable reading-place or draft-recovery protocol. No per-scroll
writes or browser credential storage were added.

The server pages annotations; only loaded notes can be marked. The interface
identifies additional pages and offers **More passage notes**. There is no
automatic whole-library load. Note archive/history inspection UI, a last-place
CAS model, full-work reading beyond bounded excerpts, comparison text panes,
offline edits and handwriting/OCR remain separate work. Existing note revisions
are retained by the database; this slice does not add a revision-history viewer.

## Verification and release boundary

- Unit tests preserve exact emoji/Arabic text, overlap identities and valid
  Unicode positions; foreign/stale/corrupt selectors do not produce marks.
- Editor tests cover combined body/style revisions, two-session conflicts,
  typing during saves and uncertain-response comparison.
- The compiled Chrome reader check exercises durable-mark rendering after
  reload, overlapping underline creation, frozen lost-response retry without
  duplicate IDs, mark-to-margin and note-to-source focus, resizable/collapsible
  margins, focused reading and 390-pixel layout. Its API transport is explicitly
  synthetic; it is not evidence of a deployed owner endpoint.
- The backend mark PR separately exercises PostgreSQL persistence and owner
  API/anonymous denial. A real identified pilot reading flow against the combined
  authenticated application is still required before calling the release usable
  across machines or closing #93/#94.

This adds no dependency, authentication bypass, public note projection, new
external request or cloud resource. It preserves existing authenticated writes,
CSRF headers, inert text rendering and private artifact exclusion. The parent
backend/schema changes still require the review recorded in the mark PR before
release; no approval or production deployment is claimed here.
