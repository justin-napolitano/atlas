# Private running research notebook

The notebook collects personal thoughts and reads existing saved passage-note
bodies and record-level reading notes directly from their original tables. Editing
a passage note in the reader immediately changes its notebook projection; no
second copy or competing note authority is created. Notebook thoughts are separate
Markdown source: note, question, source claim to check, personal interpretation or
objection. They remain private and pending review, regardless of their label.

An original thought may be unanchored, tied to a record, its immutable document,
or an exact saved annotation. A source claim requires a located annotation. Its
body is the owner's account to investigate, not a verified quotation or scholarly
finding. The exact quotation, edition and locator remain separately visible.
Source anchors are immutable; create a new thought when its evidence target
changes. Optional explicit connections target same-project records, saved passages
or notebook entries and require an explanation. Those links are not silently
promoted into the curated graph or a public projection.

## Owner API

- `GET /v1/notebook/items`: project, `q` (simple PostgreSQL full-text), thought
  type including `passage_note`/`record_note`, active/withdrawn, opaque ordering
  cursor, limit at most25. Notes interleave by most recently updated UTC timestamp
  with stable type/ID tie breaks; filtering occurs before pagination. Refresh after
  concurrent edits to rebuild the current ordering. This is lexical
  retrieval, not embedding similarity, confidence or scholarly ranking.
- `POST /v1/notebook/entries`: UUID4 request identity, project, title/body/type,
  optional immutable record/document/annotation IDs, explained links and literal
  owner confirmation. Same original request returns the existing identity even
  after later corrections; a changed request with that UUID conflicts.
- `GET /v1/notebook/entry`, `PUT /v1/notebook/entry`: project/entry identity and
  revision-bound full metadata correction. A matching lost-acknowledgement retry
  does not duplicate history. Withdrawal preserves the entry and its history.
- `GET /v1/notebook/history`: same-project entry required before bounded revision
  history access. There is no delete, review-promotion or publication operation.

All routes use existing signed-owner identity, origin/JSON/write boundaries and
redacted errors. Column grants exclude identity/anchors/review/history edits.
Migration0015 adds SQL guards for source and project binding, exact annotation
selection, explained connection targets and one-step revisions; its fixed-path
history trigger is the only runtime history writer. Anonymous/public API mode
does not register these routes. Existing publication previews exclude the notebook.

## Component contract

`ResearchNotebook({api,projectId,drafts,changed,onOpenSource,anchor})` is a standalone
owner component for the workspace. `drafts.current` is the existing shared
page-memory Map; `changed()` feeds the workspace unsaved-change warning. Draft
keys include project and entry. No private content is put in localStorage.
`anchor`, when supplied, contains `{record_id,document_id,annotation_id}`. The
explicit “New thought at this passage” action captures it without changing an
already-open draft. `onOpenSource(recordId,projectId,annotationId,documentId)`
reopens a reading note or exact immutable source. Connections can also open
another notebook thought. Root workspace wiring is delivered separately.

Creation and correction requests retain their exact payload/UUID/revision through
unknown outcomes. Readback verifies project, identity, source binding and metadata.
Conflicts show cloud and draft text; adopting cloud or retaining the draft is an
explicit choice. Retaining a draft never writes it until Save. History is paged.
Unfinished drafts survive component navigation within the current tab, not browser
loss, machine restart or device switching; only confirmed saved state is durable.

Markdown is currently stored and displayed as inert text; no untrusted HTML or
remote resource is executed. Full Markdown rendering, off-device unsaved draft
sync, automated graph-link suggestions and standalone notebook publication are
not implemented by this slice. No newly reviewed research content is seeded.

## Evidence and limits

Restricted PostgreSQL tests cover live passage/record note projections, source
anchors, filtering/pagination, two sessions, exact retries, correction conflicts,
history, withdrawal, SQL/grant/privacy enforcement and publication exclusion. A
signed-owner real HTTP round trip uses the restricted database role. These run
only on isolated CI PostgreSQL17/18; no local database or Docker daemon is started.
The compiled standalone browser uses an explicitly synthetic adapter and tests
retained creation/correction drafts, source return, Unicode, explained links,
history, withdrawal, project refusal, dark390px and no private localStorage. That
does not establish live Google authentication, cloud operation or academic review.
Owner/API/SQL/runtime changes require human security review before release.
