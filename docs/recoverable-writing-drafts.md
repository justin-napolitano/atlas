# Recoverable private writing drafts (#94)

This is an explicit-save recovery copy for unfinished record notes, newly selected passage notes, and edits to saved passage annotations. It does not save the actual note, create an annotation, change a source's review status, add a graph claim, or publish content. Keystrokes stay in page memory until **Save recoverable draft** receives a verified acknowledgement. Reopening the app on another browser can retrieve that confirmed server copy.

## Private contract

Migration `0014_private_recoverable_drafts.sql` creates `research.reading_drafts` and its append-only private history. UUIDv4 draft identity, project/record, context, source document/hash/codepoint selector and original baseline revision are immutable. Body (10,000 Unicode codepoints), mark style, active/discarded state, revision and owner actor can change under CAS. The database derives a baseline snapshot from the historical actual note, rather than trusting client-provided baseline text.

- `record_note`: any active record type. No document, annotation, hash, passage selector or capture kind; mark style `none`. Baseline is the personal-note revision, or zero for the initial empty note.
- `capture`: active source/work/edition, immutable document/hash, exact codepoint range/quotation, capture kind and baseline zero. Its draft UUID is also the retained future annotation UUID. The reader should supply the pending capture's original `selection.annotation_uuid`; otherwise recovery provides the generated UUID explicitly.
- `annotation`: the exact immutable saved source annotation and a historical annotation revision. The baseline retains original body/style independently of later actual-note changes.

The strict owner API exposes `PUT /v1/reading/draft`, `GET /v1/reading/draft`, paged `GET /v1/reading/drafts`, and paged `GET /v1/reading/draft-history`. Writes receive signed server owner identity, existing same-origin JSON/CSRF guards, request bounds and redacted errors. Unknown fields, forged actor/baseline snapshot/review fields and invalid anchors fail closed. Runtime grants exclude draft identity/base/selector updates, history writes, DELETE, public reads, and publisher access. Drafts are not added to publication inputs or semantic query datasets.

PUT carries `draft_uuid, project_id, record_id, context_kind, document_id?, annotation_id?, text_sha256?, start?, end?, exact, capture_kind?, base_revision, body, mark_style, state, expected_revision`. Revision zero creates a new identity. A retry can acknowledge only the identical successor; a different current version returns 409 with the project-filtered current draft. A source or baseline cannot move under an existing draft ID. **Keep both as separate drafts** saves the retained local payload under a new UUID and leaves the cloud draft unchanged.

**Discard recovery copy** marks it discarded and removes it from the active list. **Restore recovery copy** reverses that state with another checked revision. Private history remains available and paged. This is deliberately labelled recoverable discard, not permanent erasure; a retention/purge and backup-erasure policy remains separate work before any privacy-erasure claim.

## Reader integration

The standalone `RecoverableDraft` component accepts:

```jsx
<RecoverableDraft
  key={JSON.stringify([projectId, recordId, contextKind, document?.id, annotation?.id])}
  api={api} projectId={projectId} recordId={recordId}
  contextKind="record_note" // or "capture", "annotation"
  document={document}       // full immutable document for passage contexts
  annotation={annotation}   // saved row for annotation context
  selection={capture}       // {annotation_uuid,start,end,exact,capture_kind}
  body={currentEditorBody} markStyle={currentStyle} baseRevision={serverRevision}
  drafts={sharedPageMemoryRef} changed={redraw}
  onRecover={applyToEditor}
/>
```

For record notes omit document/annotation/selection and use mark style `none`. For capture drafts base revision is zero. A document-only capture finder can omit `selection`: saving is disabled but listing/recovery still works after reload when no in-memory selection exists. Passing the original pending capture UUID lets recovery detect whether that capture was already committed.

`onRecover` receives the full context/body/style plus `draft_uuid`, `draft_revision`, `annotation_uuid` (capture only), `base_revision`, `base_snapshot`, `current_snapshot` and `existing_annotation`. It intentionally does **not** return ambiguous `expected_revision`: draft revision is not the actual note's revision. `current_snapshot` is the fetched personal state (`note`, revision), saved annotation (`body`, mark style, revision), or null for an uncommitted capture. For a capture already saved under its original UUID, `existing_annotation` and current snapshot contain that saved annotation: reopen/edit it rather than creating a duplicate.

Before recovery, the component shows the draft, current actual saved note and any different current unsaved editor text. A changed baseline requires explicit comparison. The caller applies the selected draft only to its editor, preserving the source anchor and adopting/comparing the current actual-note baseline for its existing CAS save flow. Return `false` if the editor cannot apply recovery (for example while a save outcome is uncertain); the preview stays open and no success is claimed. Return `true` (or legacy undefined) after applying locally. Recovery never automatically saves the actual note.

The shared page-memory ref retains frozen unknown-result requests. Successful saves clear those pending entries. It stores no private data in localStorage. Source/context generation guards reject late list/history/recovery responses. Components should still be keyed by their record/document/annotation context.

## Verification and limits

Actual PostgreSQL 17/18 CI checks source/selector/baseline constraints, cross-connection recovery, exact retries, concurrent conflict, history/discard/restore, paged retrieval, restricted runtime/publisher privileges, selected public-export exclusion and signed HTTP round trips. Local execution does not start PostgreSQL or Docker on the older Mac.

Frontend tests cover context/UUID identity, wrong-source acknowledgement refusal, frozen retry, conflict versions, discard payloads and document-only recovery. The compiled Chrome fixture uses synthetic transport data persisted outside page reloads to exercise actual recovery controls, including current editor comparison, caller refusal, keeping both versions, original source capture UUID, already committed capture detection, Arabic/emoji, list/history pagination and 390px dark layout. Those browser fixtures prove the UI contract; live owner authentication and actual hosted cross-device behavior still require release verification.

Run `npm test` and `node scripts/review-recoverable-drafts.mjs` in `web/`; backend tests are `uv run --no-sync python -m unittest discover -s tests -p test_reading_drafts.py -v` against the isolated CI database. API contracts remain generated from executable routes.

Autosave, complete desk/layout synchronization, universal draft recovery for every form, and permanent erasure are not claimed. Human review is required before releasing these generated private data-access/API changes; no review approval or deployed service is implied by green checks.
