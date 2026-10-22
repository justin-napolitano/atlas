# Connected research workspace roadmap

Latest owner-approved direction: 2026-10-19. Product authority: #84; current delivery
epic [#201](https://github.com/justin-napolitano/islam-research/issues/201); technical/
hosting umbrella #30. Ownership/source/reading/organization slices #207–210 are merged;
assembled workspace #211 is in final validation. See the [delivery ledger](features/connected-workspace-delivery.md)
for actual capabilities, checks and remaining hosted/research gates.

One private workspace connects sources, reading, ordinary Markdown writing and ideas.
Nothing needs a project, collection, source, title, tags or classification to exist.
Unrelated loose thoughts are first-class notes. Organization and meaning can follow
later, or never. See [product vision](connected-research-vision.md),
[interaction/acceptance contracts](features/connected-workspace-contract.md), and
[ownership ADR 0005](adr/0005-connected-owner-workspace.md).

## Current software and preservation baseline

The Qur’an/Markdown workspace, word meanings, personal progress, keyboard advancement,
Gutenberg reading, exact note-location fix and shared source-identity foundation were
merged through #176/#181/#186/#188/#190/#191/#193/#199. The integrated stack passed
PostgreSQL 17/18, browser, owner/public container and graph checks. This establishes
software integration, not hosted two-device delivery or scholarly review.

Shelf #200 and planning #206 are merged. The connected reset keeps their compact
reading behavior while replacing required-project navigation with global writing
and optional collections. #207–210 supply the native authority/API foundations;
#211 integrates capture, Continue, organization, investigations and exploration.
No live owner data was migrated. Hosted sign-in/sync and actual owner reading remain
separate release gates, not implications of passing software tests.

## Delivery sequence (implemented in #207–211)

| Order | Delivery | Acceptance gate |
| --- | --- | --- |
| 1 | #202 global owner-workspace identities/authoring; extend #101 source identity | Create/search/edit writing and sources with no project. Preserve old tuples, exact versions, histories, recovery and publication through a rehearsed cutover. |
| 2 | #203 effortless independent capture; #140 global Continue/navigation | One action opens body-first writing. Save privately without required metadata. Return to reading/drafts unchanged; find loose notes in recent Notes/literal search. |
| 3 | #139 optional collections; #205 saved views | One object in several or zero collections; no copies. Views store queries. Rename/remove organization without losing content or changing rights/review. |
| 4 | #95 global book notebook; #96 optional developing roles; #97 meaningful links | Same Markdown/annotation IDs across views; exact source beside writing; optional question/decision/principle development and explained reversible connections. |
| 5 | #204 question investigations; #98 changes in understanding | Linked evidence, competing interpretations and provisional answers; preserve old wording and why understanding changed. Owner controls question state. |
| 6 | #141 bounded neighborhoods; #38/#34/#37 application-state retrieval | Readable local threads first. Semantic/agent suggestions remain attributable and unaccepted until reviewed. Full graph visualization/ranking upgrades are later. |

Some slices can share implementation work after their identity dependencies resolve;
this table is dependency order, not a mandate for six separate visual rebuilds. The
owner approved a coherent product reset. Preserve old data via compatibility mappings
underneath, rather than a prolonged required-project UI or hidden default project.

## Next: metadata-first sources

Owner-approved planning direction, 2026-10-20: make a reference useful before any
file import. Contract: [metadata-first sources and private documents](features/metadata-first-sources.md).
These are planned deliveries under #100/#88, not implemented upload capabilities.
PR #227 now supplies a local implementation candidate; the
[delivery ledger](features/local-source-delivery.md) records its actual scope and
verification. The source-file slice supports bounded UTF-8 Markdown/plain text;
general PDF/EPUB/OCR ingestion remains deferred.

Scope amendment: #222–225 target the **installed local Electron app only**, using
its bundled owner service, PostgreSQL and private local files. Offline desktop
acceptance comes first. Hosted web features/APIs, deployment, sign-in, cloud object
storage and synchronization are deferred. Keep shared contracts reusable and existing
web behavior intact; enforce new desktop-only capabilities in the trusted service.
Browser automation may verify the desktop renderer without making web delivery a gate.

| Order | Delivery | Acceptance gate |
| --- | --- | --- |
| 1 | [#222 minimal references](https://github.com/justin-napolitano/islam-research/issues/222) | Save URL/identifier/title offline with stable identity, no fabricated edition, safe receipts and owner search. |
| 2 | [#223 source page and connected writing](https://github.com/justin-napolitano/islam-research/issues/223) | Write immediately beside a reference; related notes/questions share original IDs and exact backlinks, without a nested interface. |
| 3 | [#224 private artifacts and coherent backups](https://github.com/justin-napolitano/islam-research/issues/224) | Retain optional originals safely; restore database plus referenced files together before selecting restored state. |
| 4 | [#225 Markdown source/note import](https://github.com/justin-napolitano/islam-research/issues/225) | Immutable source versus editable canonical note is explicit; safe assets/links, exact anchors and recoverable imports. |
| Later | #102 supported PDF/web/physical capture; #169 Open Library; #166 arXiv | Format/provider-specific coverage, rights, parser and locator evidence; no promise of universal file readability. |

#101 remains source/edition reconciliation authority; #95/#97/#104 retain notebook,
relation and locator responsibilities. #219 is merged and supplies the offline
Electron/database baseline. #54 portable archives remains open: current local
database-only restore is not a portable database-plus-files archive. Hosted cloud
sync #220 remains deferred until web deployment. No private owner state changes
as a result of this plan.

## Current refinement: reader and notebook flow

Epic [#231](https://github.com/justin-napolitano/islam-research/issues/231) and
[PR #235](https://github.com/justin-napolitano/islam-research/pull/235) refine the local
source workspace after #227/#229. The [interaction contract](features/reader-notebook-flow.md)
was committed before implementation. #232 puts formatted reading beneath a compact
source header; #234 combines source-wide, current-location and exact quotation
writing in one resizable notebook without merging their anchors; #233 simplifies
navigation to Library/Notebook with secondary research routes and the existing folder tree.
No hosted delivery or cloud sync is added. Review and native acceptance evidence
belongs in that contract; keep these issues open until the implementation is merged.

## Next: freeform skills and principles

Owner-approved #236, storage #237 and interface #238 extend the existing notebook
under #96/#87/#97. Skills and principles are standalone Markdown pages, optionally
linked to one another or evidence. No assessments, stages, scores, templates or
required connections. [Contract and acceptance](features/freeform-skills-principles.md)
are recorded before implementation. Reuse existing note IDs, body/revision/recovery
authorities, folders, links and search. Local Electron delivery; cloud sync deferred.

## Reused scope and changed priorities

- #87 remains the connected-notebook umbrella; #88 remains source intake. #101 keeps
  edition/version/source equivalence, merge/split and exact-reference work. #202 adds
  workspace-wide writing ownership, not another source identity system.
- #139 is now optional workspace collections, replacing required project folders.
  #140 is global Continue, replacing a separate project home. #143 project-management
  UI is deferred; legacy links/jobs/scope compatibility is part of #202.
- #95/#96/#97/#98 already own notebooks, optional roles, connections and changed
  understanding; refine them rather than opening duplicates. #204 supplies the
  investigation presentation and #205 the saved-view contract.
- #194/#195/#196/#197 remain library/shelf/discovery validation work. Replace mandatory
  project selection with global references and optional collections in their next
  iterations. #196/#168/#100 retain direct Open/Save/first-note behavior with no project
  prerequisite. Open Library #169 and papers #166 remain provider-specific later work.
- #38 global literal/application-state search, #34 Apache Ossie semantics, #36 ranking
  and #37 traversals are reused. Quick capture/search cannot depend on embeddings or
  AI; derived semantic coverage and accepted scholarly links remain distinct.

## Core interface

One sidebar: Library and Notebook, secondary Continue/Questions/Explore; global search, persistent
New note and optional collections. Same document surface, live Markdown, source/margin
context and charcoal/ivory/red tokens. No required project tree, extra dashboard,
provider wizard, metadata form before a thought, forced Inbox processing or mandatory
whole-graph visualization.

## Research, hosting and later work

Qur’an remains the primary real reading corpus; preserve named resources, canonical
surah/ayah and translation-specific notes. Khattab's The Clear Quran connection #185
remains a resource-access/rights gap; the implemented Itani text is not Khattab.
The actual scholarly pilot #15, editorial standards #13/#50 and real reading session
#146 remain separate from code/test completion.

One verified owner writes privately. Anonymous visitors see explicitly approved
read-only projections (#33/#41). Collection/source reuse never publishes writing.
PostgreSQL/GCP #31, backups/sync and real two-machine proof #42, and open-source
release #52 are delivery gates, not obsolete project features.

Defer elaborate whole-graph layouts, advanced rankings #36, background/history and
complexity #46/#55–58, expanded agents #53/#90, complete Obsidian sync #40, portable
restore #54, arbitrary folder hierarchies, project-management UI #143 and speculative
universal block/plugin systems. Preserve existing useful search, harvesting, reader,
research connections, safe Markdown export and source attribution.

## History and authority

The [previous project-first roadmap](roadmap-history/2026-10-19-project-first-roadmap.md)
is retained for context. Its required-project organization is superseded here; its
implemented reader/save/privacy contracts are not discarded. This documentation pass
creates/reconciles issues and contracts only. It applies no migrations, rewrites no
owner notes, changes no application code and restarts no preview.

### Local linked pages (#228 / PR #229)

Optional nesting now extends existing notebook entries rather than duplicating
content into project folders. The single sidebar tree, child creation, breadcrumbs
and moves accompany global `[[` page completion and backlinks. See the
[linked-page contract](features/local-linked-pages.md) for durability, reference
limits and remaining legacy-link indexing scope. Desktop only; cloud sync remains
deferred. PR #229 stacks on local source intake #227.

The owner’s follow-up #230 adds real local folders and direct sidebar movement to
the same PR. Folders remain organization metadata rather than notes or project
boundaries. Folder-first alphabetical order, inline creation/rename, note creation
inside folders, drag/drop and keyboard Move share the existing explorer. See the
[folder contract](features/local-note-folders.md). Cloud sync and manual sibling
ordering remain deferred.
