# Connected workspace storage and cutover contract (#202)

Implementation design, 2026-10-19; follows ADR 0005. Readable/authorable global scope
uses the configured single-owner boundary. It is not an implicit project. Existing
project identifiers become immutable origin/compatibility context, not new-note
ownership requirements. This contract is written before the migration.

## Inventory and authority

| Existing authority | Current project dependency | Cutover contract |
| --- | --- | --- |
| records / record_revisions | project FK, RDF origin/approval rules | One owner workspace; native project nullable; old IDs/origins/revisions remain |
| reading_documents | project/source FK, immutable text/notice/hash, Unicode normalization | Preserve every snapshot; verify source by stable ID and workspace for native targets |
| reading_annotations / revisions | exact document tuple and selector | Same original IDs and selector/body revision authority; no changed-edition retargeting |
| notebook_entries / revisions | project required; immutable source target and create digest | Same table/body/history; native project nullable; workspace owner required; legacy origin never rewritten |
| notebook_drafts / revisions | project and baseline/source tuple required | Same recovery authority; native project nullable; historical baseline/UUID inputs remain frozen |
| note_trash / revisions | project-bearing primary key | Existing legacy Trash remains authoritative per old object; native global tombstones need one distinct keyed authority, never two states for one note |
| reading_drafts | exact project/source/annotation baseline | Keep old draft tuple; expose global recovery by immutable origin resolution rather than copying drafts |
| library work/edition/representation/item/bindings | shared source identity, legacy project aliases | Reuse conservative identities; nullable native source origin; collection membership optional; no title merging |
| quran places/progress/note contexts | per-project PK / resource identity | Preserve all old signals; global native place/progress keys are actual resource/edition identities; competing legacy places explicit |
| Gutenberg cache/bindings/places | cache is shared, bindings/places project-based | Cache stays shared; native provider/edition/version bindings owned by workspace; legacy exact aliases survive |
| source_intakes | request UUID/digest and project/source tuple | Native owner intake without project; retain first-save atomicity/rights checks; old receipts exact |
| lexicon / verse material / citations | scoped IDs and exact original passages | Existing originals remain editable through origin-resolving adapters; global connections reference IDs; scope is scholarly context, not collection ownership |
| relations / graph / semantic search | project-scoped typed claims, RDF authority | Keep existing curated authority; private workspace links are explicit independent typed connections and safe projections, not duplicate curated facts |
| publication previews/events/heads | sealed project approval inputs | Preserve existing published artifacts and approval gates; no global-note publication path until explicit projection is verified |
| owner API / IAP / SQL grants | one verified human, separate anonymous runtime | Same owner/CSRF/origin/throttle and public read-only boundary; no user-supplied workspace or ownership escalation |
| browser draft/cache/navigation | project-qualified keys and retained components | Resolve legacy keys/URLs; no copied note database, invisible default project or lost in-flight work |
| jobs / Obsidian / export | old tuples and IDs | Keep origin aliases; declared unsupported new fields cannot silently corrupt old exports; full bidirectional sync/archive remains separate |

## Native ownership and migration

Create one private `owner_workspace` identity for the already configured owner.
Add fixed workspace identity to core objects; owner role cannot create/reassign
workspaces. Existing project values remain unchanged. Native notes and sources may
have NULL project origin, with real workspace FKs and exact global-ID target checks.
No surrogate project row is created. Native global APIs select by stable ID and owner
scope; old APIs retain their explicit original-project filters.

Migration must not rewrite content, create new revisions for old writing, combine
notes or reconcile conflicting reading states automatically. Legacy project groupings
may seed collections by reference. Native capture, recovery and organization must
work in a database containing zero project rows. Synthetic upgrade fixtures compare
original IDs/content/hashes/revisions/creation receipts, ignoring only intentionally
added metadata columns. Old qualified URLs resolve original objects.

The frontend cutover happens after global authoring and reader adapters are usable;
staging additive server commits is not a prolonged project-first product experience.
The existing owner preview is not a migration target. No runtime DDL.

## Privacy and review

| Threat (STRIDE) | Risk | Controls / required evidence |
| --- | --- | --- |
| Spoofed workspace or changed origin | High | Fixed singleton owner identity, immutable workspace/origin guards, owner-only routes and column grants; raw SQL role tests |
| Tampered note/draft/citation | High | Same immutable target/body revision authority, FK/trigger target validation, frozen UUID/digest, CAS, exact Unicode/hash checks |
| Repudiated role/connection change | Medium | Actor/revision history and retained reasons; no silent overwrite or auto-accepted similarity |
| Private content/count disclosure | High | Owner auth before query/aggregation/traversal, no anonymous global routes/grants; no private logs/storage/provider requests |
| Unbounded global scans/graphs | Medium | Bounded pages, indexed recency/IDs, literal queries, bounded traversals; no embedding/provider dependency |
| Privilege elevation through compatibility | High | Legacy origin resolved from stored IDs, never authority supplied by client; legacy public projection unchanged |
| Cutover destroys writing/history | High | Synthetic prior-schema rehearsal, aliases, transactional migrations, explicit rollback/restore boundary and refusal after new incompatible activity |

Only the owner router receives new workspace operations. No wildcard CORS, new auth,
credentials, dependencies, external integrations or changed release protections.
New data-access/permission code remains reviewable in focused PRs before release.
The local JSON adapter proves review behavior only; PostgreSQL 17/18 and public
rejection tests establish database/HTTP boundaries. Hosted proof stays #42.

## Acceptance slices

1. Native project-free note + same-table global retrieval/edit/history/recovery;
   existing origin IDs and notes remain unchanged. No arbitrary default project.
2. Native source/reader adapters and optional collections/views; canonical progress
   keys, exact edition isolation, conservative legacy aliases and safe intake.
3. Global UI capture/Continue/Notes/questions/connections and bounded Explore, with
   existing autosave/recovery/editor/reader behavior and no project requirement.
4. End-to-end migration/recovery/privacy/keyboard/mobile/zoom verification, issue
   reconciliation and one isolated local review. No claim of hosted acceptance.

## Foundation rollback operator boundary

`scripts/rollback_owner_workspace.py` checks eligibility by default; `--apply` is
migration-owner only, with `RESEARCH_MIGRATION_DATABASE_URL` injected externally.
Quiesce the new runtime and restore the matching prior binary/grants as part of a
rollback. The tool requires 0025 to be exact/latest and refuses native project-free
objects, native tombstones or incompatible note metadata. It does not erase activity
or use CASCADE. Later migration layers require their own restore/rollback plan.

Legacy sealed publication inputs explicitly omit the added workspace ownership field,
so unchanged source content retains its original preview fingerprint. Actual content,
revision and publication choices still participate in the existing seal validation.
No public global-note projection is created by this foundation.

## Native source and reader layer (0026 design)

Native source intake retains the existing structured rights/availability checks and
receipt authority, with no project origin. Native source/document binding aliases are
nullable origins derived only by the restricted indexing function. Bibliographic
ambiguity remains an explicit choice; selecting an existing legacy source resolves
its stored origin before writing, never relocates it.

Source/edition/document/annotation IDs remain globally unique. Native sources and
excerpts use the same records and immutable reading-document authorities. The native
partial content index supplies NULL-origin deduplication; an explicit source-ID
advisory lock makes retries deterministic. Exact annotation guards use NULL-safe
origin equality. First successful source-note creation and first library retention
share a transaction; a removed shelf item is never resurrected by editing notes.

Qur’an and Gutenberg native reader adapters use the real workspace key to derive
provider source IDs, not a surrogate project. New private place/progress tables use
workspace/resource/book/version keys; legacy per-project tables remain intact. Native
Gutenberg version is part of place identity. Reading an unretained catalog book still
creates no source or shelf membership. Existing origin-resolving APIs continue to
open legacy notes and sources. No network provider or rights policy is added.
