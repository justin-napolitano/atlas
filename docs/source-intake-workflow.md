# Add a source and start reading

First manual vertical slice of #88 / #100. It uses existing private source/work/edition records and immutable reading excerpts. It does not change the canonical RDF graph or establish the shared-source architecture in #101.

## Product direction update

Next delivery (2026-10-20): [metadata-first sources](features/metadata-first-sources.md),
issues #222–225 under #100/#88. Save a reference and write beside it without a file,
required project or invented edition. That contract supersedes the required metadata
and sequencing described below for future quick capture; the historical manual
fallback and its receipt/privacy/identity guarantees remain implemented behavior.
Optional managed files and Markdown import follow only after coherent backups.

This document records the implemented manual fallback. The planned default is
[seamless catalog reading](seamless-open-catalog.md): find a source, open it, and
write notes without a mandatory import. Metadata resolution and any permitted
representation storage should happen behind the scenes. Existing manual receipt,
identity, privacy and version checks remain valid; direct provider reading requires
new adapter/identity work rather than bypassing them.

## Owner workflow

1. Enter a title, URL and/or identifier, responsible people, publication/date, language, access date, edition/version, source role, and the reason for adding it. Unknown bibliographic fields stay unknown. URLs/identifiers are recorded without fetching or resolving their metadata.
2. Review conservative exact URL/DOI hints and search existing source titles. Explicitly reuse an existing source/work/edition in this project, or explain why a matching hint represents a distinct source or edition. Title similarity never silently merges records. The exact-hint check covers manual intakes; older/imported sources require title search and inspection.
3. Declare access, reading coverage, and reuse status. Keep useful metadata when full text is unavailable. To import text, explicitly declare a permitted-excerpt/public-domain/open-license basis and provide the exact edition, location, and a plain-text excerpt of at most 12,000 Unicode code points. Capturing a selected excerpt does not mean the full work was read.
4. Inspect the preview and confirm the declarations. Save a new pending private source, or retain the reused source's bibliography unchanged. The optional immutable excerpt becomes available for the existing source reader and located annotations.

The component exports `onCreated({project_id,record_id,document_id,replayed})`; `document_id` is null for metadata-only intake. The workspace integrates this callback with its project/source/snapshot URL navigation. `AddSource` takes `api`, `projectId`, the shared `drafts` ref, `changed`, `onCreated`, and optional `onCancel` and `initialPreset`. Existing project drafts take priority over a preset; presets never confirm or submit a request.

### Bounded real-article preset

`web/src/researchPilot.js` supplies `sirryPilotPreset`: Mun’im Sirry, “Who Are Those in Authority? Early Muslim Exegesis of the Qur’anic Ulū’l-Amr,” *Religions* 12(7), 483 (2021), DOI `10.3390/rel12070483`, [publisher record](https://www.mdpi.com/2077-1444/12/7/483). Its reading text is only the first four sentences of the abstract manually transcribed from the screenshot supplied by the owner on 2026-10-15. Italic formatting is flattened. This is not a publisher-file extraction, independently checked transcription, or full-argument review. The prose records the author's claims rather than adopting them as research conclusions.

The preset starts at the source-review step, shows its origin and limits, and requires the owner to inspect wording and confirm a private excerpt storage basis. No import occurs on mount. When the existing canonical Sirry source is available in the chosen project, it appears as an additional candidate for deliberate reuse; its bibliography and existing review status are never overwritten. The optional `intake_context` field persists capture provenance in the immutable receipt even when the canonical bibliography is reused. No automatic public redistribution permission, open-access status, or new scholarly review is asserted.

## Persistence and recovery

`POST /v1/source-intakes` is owner-only, uses the existing signed identity and CSRF boundary, accepts only explicit fields and literal `owner_confirmed: true`, and derives the actor on the server. `GET /v1/source-intakes/candidates` returns bounded project-scoped exact hints; `GET /v1/source-intakes` exposes bounded immutable declarations for a particular source.

Migration `0010_source_intakes.sql` adds immutable receipts. A retained UUIDv4 plus a SHA-256 fingerprint of the entire original request and authorized actor binds each save. A lost successful response can be retried without duplicating a source/document, even after the source bibliography was later edited. Reusing an existing source never overwrites its bibliography; each intake's owner-declared metadata and rights/coverage basis are retained separately in its receipt. Receipt declarations distinguish `metadata_ready` from `representation_ready`; neither means bibliographic identity, transcription, permission, or scholarship has been independently verified.

New intake, optional excerpt, and receipt commit atomically. Transaction advisory locks serialize the request ID and matching identity hints under READ COMMITTED. Matching URL/identifier hints require explicit reuse or a distinct-source rationale. They do not prove edition equivalence. Stored exact text and LF-only normalization use the existing passage contract; no Arabic or Unicode spelling folding occurs.

The browser preserves drafts only in page memory, scoped to project. An uncertain save freezes the exact request until acknowledged. Initial validation rejection permits correction; rejection after uncertainty keeps the original request frozen. Readback verifies the project, selected source, immutable excerpt, edition, location, and original wording before navigation. A private JSON draft download and unload warning support recovery; the file is not an automatic import/sync format. A draft is not durable across closing the tab until saved or explicitly downloaded.

## Source rigor and security boundaries

All bibliographic, access, rights, and coverage fields are explicitly owner-declared. New records remain pending; no reviewed status, evidential support, concept link, graph edge, or publication is inferred. Canonical RDF source/work/edition records can be selected without rewriting their bibliography or switching graph authority. The source's exact edition and representation remain attached to every reading snapshot.

No server-side URL retrieval, arbitrary file upload/parser, OCR, provider credential, dependency, background daemon, cloud provisioning, or new public endpoint is introduced. SQL is parameterized; receipt source/document references are constrained to the same project and identity in PostgreSQL. Runtime owner grants permit bounded read/insert, with no receipt update/delete or review promotion; the publisher cannot read intake receipts. New owner modules and test fixtures are outside the explicit public-build module allowlist.

Security-sensitive API/data-access/grant changes require human security review before a hosted release. Existing authentication, body/rate limits, redacted logs/errors, and anonymous publication separation stay in force. This implementation pass is not an independent security review or a new scholarly review.

## Verification

- Local strict-owner HTTP boundary checks: owner authentication/CSRF, literal confirmation, unknown actor/review-field rejection, and absent routes in public mode.
- Frontend client tests: explicit metadata/excerpt payloads, exact source/edition/location/Unicode readback, frozen lost-response retries, known initial rejection versus prior uncertainty, and mismatched-success refusal.
- `node web/scripts/review-source-intake.mjs` from the repository root (or `node scripts/review-source-intake.mjs` inside `web`): separately compiles the actual component into a temporary test-only bundle and runs owned headless Chrome against a synthetic API adapter. Covers metadata-only save, explicit review, committed-but-lost response retry, no duplicate record, project-scoped draft return, explicit source reuse, rights gating, Arabic/emoji text, bibliography preservation, 390px overflow, and no private localStorage. This adapter is not production authentication or real source content.
- PostgreSQL 17/18 CI: restricted-role persistence, atomic failure, immutable receipts, publisher denial, request replay after bibliography edit, concurrent requests, distinct-edition rationale, canonical source reuse, project boundaries, and real HTTP source/excerpt reopening across independent sessions. Local PostgreSQL was deliberately not started on the older Mac.

## Remaining #88 / #100 work

This is the manual intake slice. Provider-backed URL/DOI/catalog metadata resolution, supported PDF/document import and OCR reconciliation, conflicting provider metadata, a durable resumable intake queue, question association, and an actual scholarly article-to-first-note demonstration remain separate work. No arbitrary URL extraction, file support, full-text access, automated permission clearance, or shared cross-project source identity is claimed. Shared library membership and meaningful cross-project passage links require the #101 identity ADR/migration and authorization-aware traversal rather than cloning project-scoped records silently.
