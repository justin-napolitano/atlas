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
