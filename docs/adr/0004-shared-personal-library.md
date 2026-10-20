# ADR 0004: shared personal library with project associations

- Status: proposed architecture for owner-approved library direction; not implemented.
- Date: 2026-10-19.
- Delivery authority: existing identity issue #101; notebook issue #95; catalog #168.
- Scope: one authenticated owner, private library and authoring, explicit public
  research projections. No multi-user collaboration or new provider integrations.

## Problem and current state

The desired product has one shared library, reusable by Islam, Philosophy and
other projects. Existing PostgreSQL `records`, `reading_documents`, `notebook_entries`
and personal state use project-scoped identities/foreign keys. Gutenberg #191
retains public text separately but creates project-specific source/document bindings
when saving or writing. A visual grouping of these rows is not shared identity.

Cross-project library behavior must therefore follow an additive identity and
authorization migration under #101 before the shelf can claim reuse. This proposal
does not alter existing migrations, canonical graph authority or hosted status.

## Proposed decision

Keep work, edition/translation, provider catalog record, immutable representation,
owner library item, project membership, note and exact annotation as distinct
identities. A shelf row represents a saved work with one explicitly selected edition
for opening. Where work equivalence is unverified, retain separate rows with honest
provenance rather than inventing a shared work from titles.

Library ownership is independent of project membership. Adding an item to a second
project adds an association, not another source body, notebook or progress record.
Project research claims/relationships remain scoped research records and retain their
own editorial/publication authority. A shared book is not a shared scholarly assertion.

An optional primary book notebook uses the existing Markdown notebook/revision
authority with a library association. Other free notes and questions remain individual
entries. Exact annotations bind a representation/version/selector, not a mutable
preferred edition. The source, project and global Notebook views are projections of
the same note. A shared notebook may be associated with multiple owner projects;
legacy project notes retain their scope and may appear as clearly scoped material.

Library-level reading status and per-edition resume/progress are different records.
Changing preferred edition cannot transfer completion or relocate annotations.
Keep personal reading state independent of scholarly review. The exact reconciliation
of legacy project reading states is an explicit migration choice, not a maximum or
latest-timestamp merge performed silently.

## Migration contract before implementation

1. Inventory legacy IDs and constraints on synthetic fixtures and migration-owned
   authorized data; do not inspect owner local-preview state for planning/tests.
2. Specify additive mappings for every legacy source/document/note ID to its library
   identity and scope, including unresolved provider/work/edition identities. Existing
   URLs and APIs must keep resolving old IDs or an explicit versioned alias.
3. Use exact provider ID plus verified edition/version compatibility as evidence;
   human-reviewed reconciliation handles ambiguity. Text hashes establish representation
   equality, not authorship or work equivalence. No automatic title-based deduplication.
4. Preserve Markdown bytes, Unicode anchors, source hashes, revisions, draft UUIDs,
   Trash/history, provenance, canonical RDF IDs and public snapshot semantics.
5. Resolve differing legacy reading states and primary notebook candidates explicitly.
   Do not overwrite, sum, or concatenate competing notes/states as an implicit migration.
6. Define old/new API compatibility, transactional/idempotent membership and first-note
   retention, least-privilege grants, restore/rollback, and export/import mappings.
   No runtime DDL or second editable note/graph authority.
7. Prove migration and rollback with two projects, two translations, changed provider
   content, unresolved duplicates, old links, pending writes, archived projects,
   conflicts, hidden material and public projection tests on PostgreSQL 17/18.

Before schema/code work, attach concrete table/constraint/API decisions and the
migration rehearsal evidence/plan to #101. This ADR is a proposal until that contract
is resolved and reviewed; it is not a license to fabricate global rows in the UI.

## Authorization and recoverability

Authorize before joining/counting/searching notes, memberships or intermediates.
The anonymous runtime receives no owner library, reading activity, notebook, covers
derived from private metadata, or private counts. Publication is still a deliberate
projection; project membership or a public source does not publish a private note.

Removing a project association leaves the library item, text and notes intact.
Removing from the shelf hides membership only; retained writing remains accessible
from Notes and its original source. Trash/restore remains explicit and reversible.
Archiving a project cannot orphan a library note or delete a shared representation.

## Alternatives and consequences

Duplicating books per project conflicts with the approved shared-library outcome
and makes notes/progress diverge. Deduplicating by title loses edition distinctions.
A frontend-only combined list cannot provide durable reuse, reliable counts or
cross-device note identity. A new notebook database would create competing save
authorities. These are rejected as implementations of the approved contract.

The additive mapping approach costs a migration slice before UI delivery, but preserves
working readings and source links. Work/edition consolidation remains conservative.
Full merge/split tools, arbitrary folders, Obsidian synchronization and additional
catalog providers remain their existing issues, not prerequisites for a basic shelf.

## Minimum identity implementation decision (#101)

Implementation scope: additive owner-only identity/membership authority, before
shelf #195 and book notebook #95. Existing reader/frontend APIs remain compatible.

- `library_works` conservatively wraps each legacy source/work/edition record,
  with `identity_basis=legacy_source_unresolved`. Matching titles or provider hints
  do not consolidate existing records. Explicit project reuse references the same
  item. Reviewed work/edition merge/split/redirect remains broader #101 work.
- `library_items` owns retained shelf membership, an optional preferred edition,
  personal status and CAS revision. Backfilled rows start off-shelf, needs-review;
  migration does not manufacture a reading queue or choose a preferred edition.
- `library_editions` distinguishes original edition labels and representation URLs
  within a wrapped source; `library_representations` describes immutable snapshot
  identities/hashes/locators. No text body is copied into these tables.
- `library_source_bindings` and `library_document_bindings` preserve origin project,
  source/document IDs and representation identity. Existing note bodies, notebook
  and annotation IDs/revisions, Unicode anchors, drafts and public RDF are untouched.
- `library_project_items` adds reversible, revisioned project associations, separate
  from source ownership. Legacy source projects are recorded as legacy associations;
  removal is a tombstone, never deletion of source/notes.
- `library_requests` freezes indexing UUID/input/result IDs for retries. Indexing
  after migration adds newly created sources/documents without reassigning old
  targets. A source revision check prevents indexing unexpected metadata.
- `library_events` records confirmed item/membership revisions through triggers;
  runtime grants cannot rewrite history or identity mappings.
- Owner `/library` APIs index a legacy source, list/get items and origin aliases,
  update retained/status/preferred-edition state with CAS, associate/remove projects,
  resolve original source/document tuples, and project existing notes/counts without
  cloning. The original project remains visible on legacy notes. Public runtime
  receives neither routes nor private table privileges. New notes can use the
  returned original tuple and existing notebook/annotation APIs.

Legacy reading signals remain separately inspectable through origin personal state,
Qur’an place/progress and Gutenberg place records. No maximum/latest-state merge,
notebook concatenation, or automatic primary notebook selection occurs. Existing
resume state remains authoritative for old readers; shared per-edition resume/UI is
subsequent shelf work, not falsely claimed by this identity slice.

Roll forward: migration creates/backfills only additive identities; existing writers
continue unchanged. Re-index an explicitly chosen source after adding snapshots.
Rollback rehearsal: an administrator can remove only the new schema objects/ledger
entry when no post-migration library mutations/index requests have occurred. If
owner library edits exist, refuse rollback and require export/restore planning;
never delete new associations silently. Legacy rows remain byte/ID/revision-identical.
The rollback utility is migration-owner tooling, never an API/runtime capability.

Security review: new owner APIs and additive private-table grants require review
before release. No external integration, new dependencies, CORS, auth, publication
or runtime-infrastructure changes. Threats addressed: cross-project reference
confusion (validated immutable mappings), private count leaks (owner-only routes and
pre-filtered projections), stale/lost updates (CAS/frozen UUID receipts), destructive
rollback (mutation guard), and identity drift (no body rewrite or automatic merges).
