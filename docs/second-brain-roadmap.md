# Connected research workspace roadmap

Latest owner-approved direction: 2026-10-19. Product authority: #84; current delivery
epic [#201](https://github.com/justin-napolitano/islam-research/issues/201); technical/
hosting umbrella #30. This is a plan, not a claim that global authoring has shipped.

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

Shelf PR #200 is a separate implementation candidate. It must follow this revised
organization direction rather than cement project selection as a prerequisite. Keep
its compact/direct-reading behavior and shared identities. Do not call native global
catalog retention, a primary book notebook or the global-writing migration complete
because a shelf exists.

## Build order

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

One sidebar: Continue, Library, Notes, Questions, Explore; global search, persistent
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
