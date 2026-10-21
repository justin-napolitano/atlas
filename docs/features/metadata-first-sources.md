# Metadata-first sources and private documents

Status: implementation plan, 2026-10-20. Parent intake epic #88; delivery umbrella
#100; identity authority #101. No runtime, migration, upload or cloud service is
introduced by this document. The ordered delivery issues are listed in the
[roadmap](../second-brain-roadmap.md#next-metadata-first-sources).

## Outcome and first release

Save a reference, start writing, connect it to other thinking. A source need not
have a downloadable file or an in-app reader to be useful. Books, articles, web
pages, physical documents and Markdown can participate in the same workspace.
One source can belong to several collections or none; ordinary notes, questions,
decisions and principles can link to it without being moved or copied.

The first release is **quick reference capture and a useful source page**, not an
upload system. A URL, identifier or title is enough to begin. Unknown title,
edition, author, rights and access remain explicitly unknown. A supplied URL or
identifier may provide a temporary display label; it is not an inferred title.
Saving is an explicit owner action, not a network fetch, read mark, review or
publication decision. Optional bibliography can be completed later.

## Existing foundation and actual gaps

- `workspace_api.py` already exposes `/workspace/intake`, `/workspace/source`,
  `/workspace/sources`, intake candidates and global search under the existing API
  prefix. `workspace_store.py` already creates global sources and indexes shared
  library identities. Extend these authorities; do not add a parallel catalog.
- `source_intake.py` already supports metadata-only intake, conservative URL/DOI
  hints, explicit reuse and immutable UUIDv4 retry receipts. Today title, edition
  and rationale are required. Quick capture needs a deliberately versioned
  contract change, not fabricated edition/rationale fields in the client.
- Existing source views return bibliography and reading documents. The next
  source page must also gather related writing and questions without cloning
  their bodies or requiring full text.
- Gutenberg direct reading and the Qur’an reader exist. Open Library #169,
  arXiv #166 and general document ingestion remain separate planned adapters.
  CLI text extraction is not evidence of a shipped upload/reader feature.
- Desktop #219 is merged. Its current snapshots protect database state; adding
  external files requires a coordinated database-and-artifact backup contract.
  Cloud synchronization #220 remains deferred until hosted deployment.

## Identity and state contract

| Entity or dimension | Authority and rule |
| --- | --- |
| Source/work | Stable bibliographic identity, reusable across the workspace. No mandatory collection. Preserve legacy aliases. |
| Edition/translation | Identified when known; unresolved otherwise. Never invent a verified edition to complete a form. |
| Access link | Zero or more owner-private pointers with provider, observed access, last checked time and safe failure reason. A link is not proof of availability or a grant to fetch/publish. |
| Representation/version | Optional immutable readable version, bound to edition when known, original digest, provenance and coverage. Several may exist for one source. |
| Artifact | Optional original bytes in private managed storage. Metadata and authorization live in PostgreSQL. No renderer-supplied filesystem paths. |
| Writing | Existing canonical Markdown note/question/etc. with its own ID, revision and history; a relation points to the source. |
| Reading/review/publication | Independent existing authorities. Saving, linking, downloading and extraction never mark read, scholarly-reviewed or public. |

“Reference only”, “Available online” and “Saved offline” are derived labels from
actual links/representations, not mutually exclusive source lifecycle states.
Show unknown/unverified or unavailable when appropriate. Local bytes do not imply
an in-app supported reader. Extraction jobs have their own queued/running/failed/
needs-review/ready status; failure leaves the reference and notes intact.

Exact identifiers and normalized URL hints produce candidates, not an automatic
merge. Title similarity never establishes identity. One paper's versions and two
translations remain distinct. Explicit reuse/distinct-edition decisions retain
rationale and history. Preserve owner-entered metadata alongside attributed
provider assertions and conflicts; do not silently replace it during enrichment.
Do not introduce a universal objects-table rewrite or change canonical RDF
authority as a prerequisite.

## Interaction contract

1. Library's Add source accepts a pasted URL/identifier or typed title on the
   existing document surface. No provider wizard, project selector or mandatory
   bibliography form. Keyboard submission and a small visible action both work.
2. Save opens the source immediately. Show one title, concise known attribution,
   honest access action and related writing. Unknown fields need no empty form
   furniture; optional details remain available.
3. Write beside the source with the same live Markdown editor, save indicator,
   draft recovery and conflict handling as Notes. No Write/Preview switch or
   required thought-type dropdown. New writing links to this source; existing
   loose writing can be linked without moving it.
4. Questions and notes are original records returned through paginated typed
   relations. Personal association is not evidential support. A support/challenge
   assertion still needs attribution, scope and located evidence under #97.
5. Open a retained supported text directly. A reference-only or physical book is
   still a complete source page with writing; explain missing reader availability
   in a short status, not a broken empty reader.
6. Preserve the open note, selection, unsaved draft, reading position and history
   when following a source or backlink. One sidebar and existing charcoal/ivory/
   restrained-red tokens remain; do not create a site inside the workspace.

Design references are the already approved [workspace brief](../design/unified-workspace-brief.md):
Obsidian's document/backlink behavior, Bear's restraint and Readwise Reader's
source context. Reuse these behaviors, not another application's full navigation.

## API and durability contract

Extend existing workspace intake/source/search routes and existing relation
authorities. Before implementing, publish request/response schemas and migration
notes with explicit legacy-client compatibility; routes above describe current
code, not promised new fields. New request semantics must not invalidate old
receipts or silently change the payload replay hash.

- A minimal reference request has a retained UUIDv4, supplied reference, optional
  known metadata and explicit owner save intent. No guessed edition or declared
  reading coverage. An unresolved reference has a stable ID immediately.
- Atomically persist source, necessary identity mappings, retention and receipt.
  Identical actor/payload retries return the same result; a changed payload with
  the same UUID is a conflict. Preserve current source reuse decisions and never
  overwrite existing bibliography during a retry.
- Metadata edits and links use the established revision/optimistic concurrency
  rules. Failed/uncertain saves preserve drafts and offer exact retry; no duplicate
  sources or lost notes after a lost response, restart or offline operation.
- Source overview and owner search return original IDs, revisions, relation type,
  edition/version and actual locator when applicable. Bound and paginate results;
  source reuse never grants public traversal/count/search visibility.
- Agent retrieval reuses authenticated application-state search #38, including
  loose writing and reference-only sources. Semantic indexing is derived and
  optional; literal search and writing require no AI. Imported content is evidence,
  never an instruction. Agent interpretations remain attributable proposals.

## Locations and later files

A source-level note may have no location. A physical-book page or manually entered
section is a declared locator, distinct from a verified digital selection. Actual
highlights retain the exact edition/version, text digest and selectors. Qur’an
surah/ayah plus named translation and Gutenberg snapshot/paragraph anchors survive
unchanged. Replacing text must never silently retarget existing annotations.

Local file retention follows reference capture; it is optional. Use app-managed,
owner-private storage outside the replaceable app bundle. Persist opaque artifact
keys, digest, byte size, detected media type, original display name, rights basis,
ingest provenance and version in PostgreSQL. A user-selected external file path may
be a local-only reference but is neither a portable managed artifact nor an
automatic reading permission; never send it to public views or agents by default.

Stage bytes in a private temporary area, enforce limits, calculate the digest,
durably commit immutable bytes, then transactionally register their manifest and
receipt. A crash before registration leaves a reclaimable orphan, not a dangling
successful file reference. Retrying reconciles the receipt/digest. Digest reuse
does not merge editions. Define bounded cleanup and retention before enabling
deletion; referenced files and backups must not be garbage-collected.

Backup must capture a coherent database snapshot plus all artifacts referenced by
that snapshot, with a versioned manifest and verified digests. Concurrent writes
must not produce a snapshot missing a committed artifact. Restore into a fresh
database and fresh artifact namespace, validate both before atomically selecting
them, and retain the original. Detect legacy database-only backups honestly.
Test missing/corrupt files and interrupted restores before shipping file retention.
Future GCP storage can implement the same artifact interface; no bucket provisioning,
background upload or cloud sync belongs to this delivery.

## Markdown and document readers

- A Markdown file imported **as a source** retains original bytes and an immutable
  reading version. An imported **editable note** uses canonical PostgreSQL Markdown
  and revisions; `.md` exports are portable outputs, not a second editable authority.
  Preserve the original import separately for provenance. Let intent be chosen at
  the import boundary, not in every subsequent writing session.
- Preserve Unicode and original bytes; record any decoding/normalization transform.
  Parse front matter as untrusted metadata, never executable configuration or agent
  instructions. Show unresolved relative assets and wiki links honestly. No automatic
  local-file traversal, active HTML/script, remote images or asset downloads.
  Supported bundled assets need validated paths, manifests and the same backup rules.
- First retained format is bounded UTF-8 Markdown/plain text with explicit limits.
  Selectable-text PDFs, web capture and physical-book workflows stay under #102.
  EPUB, OCR, arbitrary archives and broad URL extraction follow only with explicit
  reader/locator/parser contracts, not a claim that every file is readable.
- Text extraction is a derived projection carrying parser/version, coverage,
  original digest and failure/verification state. OCR cannot acquire verified quote
  status automatically. Never execute a document or silently send it to external OCR.

## Privacy, trust boundaries and release gates

Personal notes and private artifacts are private owner data; bibliographic facts
are not automatically approved for public release. Keep contents, filenames,
credentials and credential-bearing URLs out of logs, public issues and fixtures.
Authorize every source, relation, artifact and search read/write server-side.
Anonymous users see explicitly published projections only, never raw file paths or
private counts. Opening external access links is deliberate; saving a pointer has
no outbound fetch. Future resolvers must validate protocols, destinations and every
redirect against internal/metadata endpoints, with bounded bytes/time/retries.

Before parser/transfer/storage implementation, retain a scoped STRIDE analysis with
risk ratings and mitigations for spoofed media, parser execution/path traversal,
SSRF, private backlink leakage, duplicate/replay mutation and destructive restore.
Identify security review for API/authorization changes, new dependencies and
privileged desktop filesystem/restore operations. This planning pass approves none
of those controls by implication. Existing loopback/session/CSP/least-privilege
boundaries stay intact. Use synthetic isolated databases and files only.

| Acceptance scenario | Required result |
| --- | --- |
| Save URL, DOI, title or physical-book reference offline | Stable reference and first note survive restart, without a fetch, fake edition or read mark. |
| Duplicate candidate; uncertain edition; retry after lost response | Explicit reuse/distinction, same receipt result, no overwritten metadata or duplicate source. |
| Loose note linked to two sources/collections | Same note ID/body/revision everywhere, with correct backlinks and no ownership change. |
| Dead link or unsupported document | Reference and writing remain usable; access/extraction status is honest. |
| Metadata change, new representation, conflicting editor | No silently retargeted highlight or lost revision/draft; exact old locators still resolve or explain absence. |
| Markdown note/source import with unsafe links/assets | Clear authority, preserved original, inert unsafe content, bounded safe rendering and export. |
| File ingest crash; missing artifact; corrupt restore | No successful dangling file pointer; recoverable original state; no partial selection. |
| Owner/private/public search and agent context | Private results require owner access; public views omit private records, snippets, paths and counts. |
| Existing Qur’an/Gutenberg reading | Same exact notes, progress/place, shelf identities and named text resources. |

Implementation evidence must cover PostgreSQL 17/18, real browser flows and the
packaged offline Electron app where affected. No live owner database or notes may
be test fixtures. Do not mark an issue complete based only on unit tests or this
document; record actual checks and remaining usability/release gates in its PR.
