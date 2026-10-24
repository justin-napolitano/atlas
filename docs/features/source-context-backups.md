# Source-aware Markdown backups

Implementation #258 extends [application-owned backups](app-owned-backups.md).
Atlas remains authoritative. A selected note can retain its source context outside
Atlas without uploading the original ebook, article or reading-document text.

## Supported selection

The existing Markdown backups surface supports workspace-wide source-level notes,
document-position notes, passage-bound notebook notes (including source claims),
Qur’an verse/surah/source notes, and reader annotations with saved note text.
Preview my pages lists notebook entries; Preview passage notes lists existing reader
annotations. Both use the same reviewed, bounded delivery. Annotation backups point
at the original annotation authority, not a duplicate notebook entry. Empty highlights,
legacy project writing, Trash and unsupported metadata remain excluded.

The review shows source titles, known creators, edition and locator, exact quotation
and included annotation text. Required explicit `record`/`annotation` link dependencies
are captured with the selected note. Those related annotation bodies are included in
the review; they are not a claim that every annotation in the workspace was selected.
Typed note-to-note links retain stable IDs and the existing dependency checks.
Separate workspace graph connections, collection membership and scholarly graph
records are outside this profile; a graph-only source association is not converted
into an invented direct source binding.

## Portable files and versioning

Notebook Markdown keeps its exact existing path and bytes: `notes/<uuid>.md`.
Source-aware notebook metadata uses format 2 at `.atlas/pages/<uuid>.json`.
Reader annotation Markdown uses `annotations/<uuid>.md` with format 2 metadata at
`.atlas/annotations/<uuid>.json`. A separate readable citation companion lives at
`citations/note-<uuid>.md` or `citations/annotation-<uuid>.md`. Generated citation text
never becomes part of the saved note body. Metadata text is escaped in the companion.

Format 2 page records retain the normal title/type/links and a bounded version-1
`source_context` object:

- `binding`: exact record/document/annotation IDs, optional note position and Qur’an
  scope. A note position is not a synchronized reading-progress record.
- `sources`: source kind/ID/title, original source revision, optional project context,
  known bibliographic declarations, catalog/resource identifiers and library work/item
  IDs. Intake and known catalog creators/translators/edition metadata are projected;
  arbitrary source attributes, private actors and review history are not copied.
- `documents`: original document ID, edition/locator/representation URL, normalization,
  input/text fingerprints, text length, source notice and library edition/representation
  IDs. Original local artifacts have stable ID/digest/size pointers and `included:false`.
- `annotations`: original annotation ID/revision, document fingerprint, exact quotation,
  Unicode character range, prefix/suffix, capture kind, saved annotation body and style.

No source document `text_body` is exported. Bibliography not recorded in Atlas stays
unknown; edition identity is never inferred from a shared title. Repeated quotations
retain their exact range and fingerprint rather than a text-search reassociation.

The JSON Schema is `resources/vault-page-v2.schema.json`; the source codec also
validates exact field sets, types, versions, counts, dependency membership and binding
consistency. Existing page/receipt format 1 stays readable and unchanged. A batch with
source context uses receipt format 2, which adds a citation SHA-256 per source-aware
page and explicit new coverage exclusions. Verification checks all three raw files at
the confirmed Git commit. Standalone-only batches still use receipt format 1.

Source context is limited to 64 KiB before page-envelope validation, at most 26
records of each dependency kind, ten original-artifact pointers per document and
the existing ten selected notes per batch. Oversized selections are excluded or
rejected, not silently truncated. The existing total commit bound still applies.

## Recovery and application integrity

App recovery inspection remains read-only. It compares current writing and source
bindings, reports changed bibliography/editions/passages and missing originals, and
does not overwrite notes, re-anchor quotations, import records or replay tasks.
Private destination identity/visibility checks and desktop owner-session protections
still apply. Hosted/public APIs cannot access these capabilities.

The existing explicit internal import utility supports synthetic reconstruction.
Source-level notes can reconstruct from bibliographic metadata alone. A document-bound
note requires the original text separately, matching the recorded input and normalized
fingerprints and length. It never inserts padded/fake documents to satisfy foreign
keys. It reconstructs source/document/annotation IDs and typed relationships through
existing application authorities, atomically; competing identities or partial failure
roll back. Originals are caller-supplied data, never fetched from an exported URL.

Restored sources start as unreviewed local records and current revisions start a new
local history. Coverage retains original source application revisions; this is not a
revision-history migration. Explicit existing source/annotation differences are not
overwritten. Full reader restoration still needs coordinated original artifacts and
database recovery, separate from this selected Markdown profile. No owner-facing
import mutation button is introduced here.

Migration 0038 enrolls existing notebook entries or annotations in the same backup
queue. A trigger enforces an existing target and immutable enrollment identity;
annotation edits advance pending revisions in their own save transaction. There is
no owner-content rewrite. A related lookup fix uses null-safe project comparison so
workspace-wide Qur’an notes retain their existing scope metadata.

## Validation and review

Synthetic tests cover exact Unicode/RTL/CRLF note text, source-level and anchored
notes, catalog authors/translators, distinct editions, repeated quotations, unknown
versions/fields, changed source context after review, tampered citation companions,
annotation lost acknowledgements/newer writing, queue integrity and fresh-database
reconstruction with missing/wrong/correct originals. Native acceptance exercises both
notebook and reader-annotation selection, context review, confirmation, recovery,
keyboard focus, reload and 390px overflow. Final results are tracked in #258.

Private metadata disclosure, stale/tampered snapshots and orphaned or rebound IDs are
the main risks: reviewed dependency disclosure, strict bounded schemas, expected-head
delivery, exact-byte receipts and conflict-preserving recovery address them. Imported
Markdown/metadata stays untrusted; no code, hooks or task instructions run. No new
dependency, credential provider, public route or URL-fetching capability is introduced.
Native-auth/private-data release review remains flagged, not externally approved.
No owner installation, migration, first upload or automatic backup is performed by
building or testing this feature.
