# Local source intake: implementation and verification

Delivery: #222–225, based on the [metadata-first contract](metadata-first-sources.md).
Target: installed Electron app only. Hosted web and cloud sync remain deferred.

## Runtime contract

Only `desktop-serve`/the frozen desktop service supplies a private artifact root
to `LocalOwner`. That trusted Python argument registers `/v1/desktop/*` on the
owner router. Ordinary owner/public and local browser launches do not register
these routes. The renderer discovers this capability after signing in; a renderer
header, query parameter or environment flag cannot enable it on hosted services.
Existing owner/session/origin/CSRF/rate/body limits remain in force.

New reference requests use `/desktop/references`: UUIDv4 `request_uuid`, supplied
`reference`, optional explicit `existing_source_record_id`/`distinct_reason`, and
`owner_confirmed: true`. Migration 0031 adds separate immutable-request/artifact
tables, preserving all legacy intake receipt hashes and required-field contracts.
References have unresolved bibliography; URLs/DOIs are labels until corrected,
not claimed titles or verified editions. No metadata lookup or fetch is performed.

`/desktop/source/metadata` uses a UUID receipt and expected source revision to
correct owner-declared title/creators/edition without retargeting reading versions
or changing review status. The optional Bibliography area preserves conflicting
drafts for explicit comparison. URL pointers remain searchable after title edits.

`/desktop/source/writing` combines the existing book notebook with explicitly
linked writing/questions in either direction; it does not duplicate writing bodies.
Existing connections can link loose writing to a source. Exact
passage notes retain existing document/digest/selector authorities.

`/desktop/files` accepts UUIDv4, basename, base64 bytes, `intent` source/note,
retention `rights_basis`, optional `record_id`, explicit owner confirmation.
Supported originals are non-empty UTF-8 `.md`, `.markdown`, `.txt`, **up to 32 KiB**.
This fits the unchanged 64 KiB JSON boundary. Editable notes are additionally
limited to the existing 20,000-character notebook contract. Larger source texts
are split into immutable reading snapshots of at most 10,000 characters; original
bytes and their digest remain intact. Existing excerpt normalization is derived,
not an overwrite of the original. A digital-file digest label is not a verified
print edition. Markdown note editing uses the existing live Markdown editor;
reading snapshots use the existing selectable-text reader.

The renderer never supplies a filesystem path. The private service stages bytes,
fsyncs them, atomically creates content-addressed originals and fsyncs the directory,
then registers manifests, source/notes/documents and the receipt in one database
transaction. Failed registration may leave an unreferenced private object; there
is deliberately no automatic garbage collection or file deletion in this release.
Snapshots include referenced objects only. A repeated digest reuses bytes without
merging sources or overwriting an edited note. Original front matter and links
remain inert text; no dependency, script, remote image or local asset is executed.
Asset bundles, PDF, EPUB, OCR, URL extraction and folder watching remain deferred.

Desktop backups now have format-2 receipts and a sibling `.objects` directory.
The exported PostgreSQL snapshot determines both table counts and artifact manifest;
immutable referenced bytes cannot be deleted while it is captured. Restore validates
the archive and every object, restores into a fresh database and artifact namespace,
checks the database manifest and grants, then selects both through one config
replacement. Originals stay available. Legacy format-1 DB-only backups are accepted
only when they claim no external artifacts. Supported manifests are bounded at
4096 distinct objects; larger archives fail explicitly pending reviewed expansion.
These are installation-local verified backups, not portable arbitrary SQL imports.

## Scoped threat review (STRIDE)

Private user notes/artifacts may contain sensitive information. All examples and
tests use synthetic files and isolated clusters; no owner data is a test fixture.

| Threat | Risk before controls | Controls and required evidence |
| --- | --- | --- |
| Spoofed desktop flag or owner identity | High | Trusted service registration only; existing session/origin/CSRF checks; absent-route and cross-owner tests. |
| Artifact path traversal or symlink replacement | High | Server-chosen digest keys; basename/type/size checks; private directories, no-follow reads, atomic creates and digest verification. |
| Document script/front-matter execution or SSRF | High | UTF-8 text only, inert rendering, existing CSP, no resolver/network/parser execution, no ambient local asset reads. |
| Mutation after an uncertain save or duplicate identity | Medium | Actor/payload/operation-bound UUID receipts, serialized candidate checks, explicit reuse/distinction, existing revision authorities. |
| Private writing through source reuse/public views | High | Owner-only desktop routes; original private notebook reads; no new publication paths; existing anonymous regression checks. |
| Oversized import or unbounded backup manifest | Medium | 32 KiB original, unchanged 64 KiB request, bounded notebook/reading chunks, 4096-object manifests. |
| Interrupted import/restore loses research | High | Durable immutable bytes before registration, transaction receipts, snapshot-based manifests, verified fresh restore, original database and artifacts retained. |
| Privileged cleanup deletes a referenced artifact | High | No automatic deletion or garbage collection. A future retention/deletion design needs its own review. |

Review required before merge for API/data access, privileged filesystem and restore
changes under the applicable security guidance. No new dependencies or public
endpoints are added. This document records design and verification evidence, not
an assertion of external security approval.

## Verification ledger

- New synthetic PostgreSQL reference/file tests: metadata-only save/replay, explicit
  candidates, original bytes, Unicode selectors, note-authority preservation,
  file validation, pagination/trash and corruption rejection.
- API boundary tests: desktop routes absent from ordinary owner/public schemas,
  renderer flags ineffective, owner and explicit CSRF/write intent required.
- Existing frontend unit suite: 166 passed after the initial integration.
- Production frontend build: passed after the initial integration.
- Full existing PostgreSQL 17 regression after the initial delivery: 374 tests,
  passed with one skipped. Follow-up metadata/reverse-link tests: 13 passed.
- Copied frozen runtime with native sandboxed Electron: reference capture,
  source-level Markdown autosave, local-file reading, isolated fresh PostgreSQL,
  close/reload/reopen, consistent database-plus-original-files restore, corrupt
  object/archive rejection, existing Qur’an notes/library/progress: passed.
- Final follow-up package rebuild and CI PostgreSQL 18: pending; update this ledger
  with actual results before release. Initial copied-runtime evidence predates the
  final bibliography UI and reverse-link refinements.

Do not close #222–225 from this document alone. The installed owner app is not
replaced or restarted by test builds; review uses separate synthetic state.
