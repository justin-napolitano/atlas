# Shared library identity foundation (#101)

Implementation candidate: PR #199 under shelf epic #194, stacked on Gutenberg
#191 and merged planning #198. This is the backend identity/association slice;
shelf #195, discovery #196 and primary book notebook #95 remain separate.
See [ADR 0004](../adr/0004-shared-personal-library.md) for the resolved minimum
migration design and [shelf contracts](library-shelf-contract.md) for product behavior.

## What changes

Migration 0024 adds private owner-library identities around existing source,
edition and immutable reading-document IDs. An item can be associated with another
project without cloning its text or notes. Library note views return the original
notebook/annotation ID, origin project, body and current revision; edits continue
through the existing save/recovery APIs, not a new notes database.

Backfill creates a conservative work wrapper per legacy source/work/edition
record, marked `legacy_source_unresolved`. Different records with the same title
or provider hint remain different items. Edition labels and representation URLs
distinguish legacy editions within that wrapper; text hash, notice hash, locator
and normalization distinguish representations. These are compatibility identities,
not verified claims that editions/translations are equivalent.

No existing source, reading text, Markdown, exact selector, revision history,
Trash record, draft UUID, canonical RDF, public snapshot or legacy URL is rewritten.
Library representation tables contain metadata only, never another full text copy.
Display titles follow current source bibliography; `identity_title` preserves the
original label, while aliases expose indexed and current source revisions.
Original source/document IDs remain valid through the old APIs. Resolution through
the library returns that exact original tuple, even from another project context.

## Migration and reconciliation

Use the existing migration-owner workflow (`database.migrate`) to apply 0024,
then refresh/audit owner/public roles through `sql_permissions.configure` before
starting the updated owner runtime. Runtime does not execute DDL. Indexing uses
one explicitly granted, fixed-search-path security-definer function which can only
derive deterministic aliases from existing source/document rows. Runtime cannot
insert/edit arbitrary work, edition or document mappings directly. History is
written by trigger and cannot be rewritten through runtime grants.

The additive backfill leaves inventory off-shelf, reading status `needs_review`
and preferred edition unset. It records legacy project associations and preserves
legacy personal reading signals separately. It does not guess which old references
are wanted books, merge competing reading states, concatenate notebooks, or select
a default primary book notebook. Existing project readers continue to work.

Sources/documents created after migration are indexed by an explicit owner action
with a UUIDv4 request and expected source revision. Retrying that frozen input
returns the same identity; changed input under the same UUID conflicts. Indexing
never re-adds an item the owner removed from the shelf and never promotes review.
Saving/retaining and preferred-edition selection are separate explicit CAS actions.

## Owner API contract

All routes below are under `/v1`, behind existing verified-owner/JSON-write/origin
checks and rate limits. `owner_confirmed: true` is required on writes. Unlisted
fields, boolean-as-integer revisions and invalid state names are rejected. No
owner ID, review state or arbitrary provider/merge authority can be supplied.

| Method and route | Purpose |
| --- | --- |
| GET `/library/source?project_id=…&source_record_id=…` | Look up an existing source's alias and item revision |
| POST `/library/index-source` | Index one existing source and its current snapshots with frozen UUID/source revision |
| GET `/library/items` | Bounded identity inventory; retained items by default, `retained=false` for reconciliation |
| GET `/library/item?item_id=…` | Item state, edition/note counts, project associations and separate legacy reading signals |
| PUT `/library/item` | CAS shelf retention, personal reading status and nullable preferred edition |
| PUT `/library/project-membership` | CAS active/removed project association; original source scope remains intact |
| GET `/library/editions?item_id=…` | Paginated original edition identities |
| GET `/library/documents?item_id=…&edition_id=…` | Paginated original document/representation metadata |
| GET `/library/resolve?item_id=…&document_id=…` | Validate exact work/document association and return original reader target |
| GET `/library/notes?item_id=…` | Paginated existing writing with original save IDs, scope and revisions |

Optional `project_id` on library item/edition/document/resolve/note reads filters
through that project's nonremoved association. Without it, the owner can access
the global item. Removing a project association makes that context unavailable,
but does not remove writing from the global owner library. The original note's
`project_id`/`origin_project_id` is never replaced by the viewing project.

Pages default to 30, maximum 50, with a bounded cursor and stable ID ordering.
This identity inventory does not implement the recency/search/Continue UI of
#195. Item-page note counts use one bounded batch, not a separate request per row.
Counts include distinct active notebook notes/questions, annotation bodies and
legacy source-note bodies. Exclude Trash, withdrawn entries, empty/quote-only
annotations and unavailable/withdrawn source material. A virtual annotation
projection is not counted twice. Existing source-note bodies retain their personal
state writer rather than being copied into a notebook entry.

Synthetic request shape for indexing (IDs are examples, never live owner data):

```json
{
  "request_uuid": "00000000-0000-4000-8000-000000000001",
  "project_id": "synthetic:origin",
  "source_record_id": "synthetic:source",
  "expected_source_revision": 1,
  "owner_confirmed": true
}
```

To reuse that book in a second project, send its returned `item_id`, the second
`project_id`, `state: "active"`, `expected_revision: 0` and owner confirmation
to the membership endpoint. The response supplies the actual membership revision.
Resolve a document in that context to obtain its original `project_id`, `record_id`,
`document_id`, `edition_id`, `representation_id`, `text_sha256` and locator.
Open it through the existing reader and save through the original notebook/annotation
authority. No source/document/note is copied into the second project.

State and membership retries return the same confirmed revision only when the
expected revision plus exact desired fields match the committed outcome. A
different intervening revision returns 409/current state. Membership removal and
off-shelf state remain reversible tombstones. No API deletes book text or writing.
Changing preferred edition validates work membership and never updates old anchors.
An unavailable original source is explicitly reported on resolution; notes are not
retargeted to another edition.

## Rollback/restore boundary

`scripts/rollback_library_identity.py` checks eligibility by default, using only
`RESEARCH_MIGRATION_DATABASE_URL` configured externally for the migration/schema
owner. Quiesce the updated runtime before rollback. `--apply` removes the additive migration only after validation. It is never
an owner API or a runtime privilege. Do not use runtime or live owner-preview state
as an experimental migration target.

The tool requires exact/latest migration and artifact checksum, locks new tables,
and refuses if indexing receipts or any post-backfill library state/membership
activity exists. It uses no CASCADE and never modifies legacy source/text/note
tables. When owner library activity exists, export/restore planning is required;
silently discarding it is not a rollback. Restoring the pre-upgrade application
requires the matching grants/binary and its normal backup/recovery process.

The isolated test rehearsal upgrades a prior schema containing synthetic Unicode
text, Markdown and reading history, verifies aliases, rolls back, compares every
legacy row, reapplies with identical IDs, and verifies refusal after library editing.
It never drops or migrates the CI application's shared database for that rehearsal;
it creates and removes a dedicated synthetic database.

## Privacy and review

| Threat | Mitigation |
| --- | --- |
| Cross-project reference confusion | Membership context and exact item/document/work checks; original tuple and scope returned |
| Private body/count leaks | Owner-only routes, no public grants/schema routes, source/Trash/withdrawal filtering before projection |
| Forged identity or scholarly promotion | Deterministic restricted indexing; readonly identity grants; no merge/review/publication fields |
| Duplicate/stale saves | Frozen indexing UUID/digest, row/advisory locks, CAS membership/item state and trigger revision history |
| Destructive migration/rollback | Additive metadata mappings, unchanged legacy rows, explicit migration-owner tool and mutation guard |
| Resource abuse | Input limits, bounded pages, existing owner throttling and fixed-batch counts; no new provider requests |

Single verified owner remains the authorization model; project associations are
organization, not invitations to other users. Anonymous publication still uses only
the existing explicit projection. This change adds no dependency, network provider,
CORS exposure, credentials, logging payload or deployment setting. New owner routes,
private grants and security-definer code require human security review before release.

## Evidence and remaining work

Local authenticated HTTP/schema checks pass. Real PostgreSQL 17/18 tests cover
upgrade/rollback, legacy rows/anchors, one item used by two projects, two editions,
changed snapshots, same note/revision after original-authority editing, uncertain
duplicates, indexing/state/membership retry/conflicts, removal/Trash/counts,
withdrawn targets and runtime/public permissions. CI results are pending for this
candidate; a skipped local database test is not database evidence.

Not implemented here: shelf frontend #195; native catalog-to-global-library save
and first-note retention #196; primary book notebook #95; automatic updating of
library aliases from old writers (explicit indexing is required); shared edition
resume/progress reconciliation; provider/work-equivalence merge/split/redirect and
portable library export/restore; arbitrary folders; archived-project lifecycle;
agent/Obsidian synchronization; hosted provisioning/deployment/two-device proof.
The full #101 remains open. These limits do not change existing readers, project
notes, provider caches, saves or publication behavior.
