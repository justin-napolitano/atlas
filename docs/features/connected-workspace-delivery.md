# Connected workspace delivery

Delivery date: 2026-10-19. Epic #201; product roadmap #84.
Implementation: #207 ownership, #208 sources, #209 native reading, #210 organization,
#211 assembled frontend and compatibility. All five implementation PRs are merged.
The final #211 head (`655d55b`) passed PostgreSQL 17/18, assembled and retained
browser flows, owner/public containers and graph checks before merge. This is not
a claim of deployed hosted authoring or owner usability acceptance.

## What the owner can do

- Open Continue, Library, Notes, Questions or Explore from one sidebar. No project
  needs to be selected or created. Historical groups become optional collections.
- Use **New note** or **Cmd/Ctrl + Shift + .** to focus a blank Markdown body.
  The first meaningful line supplies a display name until it is renamed. A loose
  idea remains unlinked, even when captured during reading. Cmd+N and the reader's
  annotation shortcuts retain their existing behavior; composition is not interrupted.
- Read the existing Qur’an and Gutenberg resources, write margin thoughts, select
  exact highlights, follow original passages beside a note, resize the context pane,
  and return to the reading/selection without losing independent writing.
- Reopen writing from Notes, recent writing, Continue, global literal search,
  a book notebook, a question, a collection or a live saved view. These reference
  the same IDs and revisions. Connecting a loose note as `comments_on` a source
  includes it in that book's notebook without inventing a quotation/position.
- Optionally develop a thought into a question, interpretation, objection, decision,
  principle or **source claim to check**. A personal role does not create a reviewed
  scholarly claim. Inspect earlier wording in revision history.
- Gather an investigation with explained links and owner-selected state. Record
  reasons and uncertainty against an original note revision, optionally selecting
  the exact passage that prompted a change. Source counts never answer a question.
- Use overlapping collections; remove membership or rename/archive organization
  without deleting writing. Save bounded live note/source/question/reading views,
  including unanswered questions and notes without a source. Search has no AI or
  external-provider dependency.
- Follow a bounded neighborhood or its readable relationship list. Correct/withdraw
  private links. Scholarly acceptance requires attribution and a located source
  annotation. Original curated references retain provenance and their authority.

The Library also presents the available **Qur’an** as a book. Its built-in entry
opens the existing reader without creating a source or read/completion state.
Retained readable Qur’an rows share one book presentation; opening keeps the
most recent confirmed edition/verse tuple. Notes, progress, source IDs and histories
remain edition-specific and are never summed or merged. Before a first read the
built-in book appears under All and matching searches, not Reading or Finished.

The original specialist research tools remain available through the sidebar's
secondary **Advanced research tools** link. This retains existing lexicon, citation,
comparison, review/publication and compatibility operations during the reset.

## Storage, identity and access contracts

`owner_workspaces` is a real private workspace, not a default/sentinel project.
All core notes/sources/documents have a workspace owner. New loose writing and
native sources/readers have a null legacy project origin. Existing qualified
source contexts keep their original tuple when using compatibility writers. No
runtime may reassign the origin or workspace column of existing writing.

Migrations 0025–0030 preserve the old bodies, IDs, Unicode selectors, document
versions, revisions and publication inputs. Legacy groups map once to optional
collections through an immutable alias table. Collection membership never becomes
an ownership boundary or public ACL. Unknown equivalent editions/progress are not
silently merged. Later organization edits do not rewrite historical project records.

Notebook entries remain the single Markdown body authority. Exact annotations and
older per-record source notes keep their own existing save/revision authorities;
book/collection/question views are projections. Native reading places/progress have
owner keys; historical project-qualified places remain distinct. Native note and
annotation Trash is reversible and blocks editing until restored. Reflection reasons
refer to actual immutable note revisions; aliases and reasons are append-only.

Capture keeps frozen creation UUIDs and CAS writes. Slow acknowledgements never
replace newer typing. Independent captures own separate recovery identities. Empty
existing drafts are held, not falsely acknowledged as a previous body. Conflicts
show the other version and require an explicit choice. Recovery is persisted through
the same owner API; private writing is not placed in browser storage. A lost response
or offline failure remains visible. Local JSON/synthetic browser boundaries are not
proof of PostgreSQL sync or hosted durability.

All new routes live under the verified owner router, with existing CSRF, bounded
queries, rate limiting and redacted logs. Public mode registers none of them and
receives no private table grants. No new auth provider, secret, CORS exception,
dependency, provider crawler or publication shortcut is introduced.

## Semantic and retrieval contract

The pinned Apache Ossie model now describes owner-global identities, collections,
views, private connections, investigations and dated reasons. Historical composite
joins remain compatibility metadata; additional global ID joins describe native
source/document/annotation relationships. Polymorphic references require target
kind plus ID. A title match is not identity or evidence.

Registered owner operations include literal current application-state search,
Continue, source/passage lookup, supported version-1 saved query filters and bounded
1–2 hop neighborhoods (at most 100 nodes/edges). Search can return current writing,
source/research metadata and exact annotations, with original IDs/version locators.
Neighborhoods add existing note/source/curated references without creating another
editable curated graph. Rankings/embeddings beyond the existing registered policies
remain deferred, with truthful coverage and lexical fallback.

## Verification ledger

- PostgreSQL 17/18: #207–210 passed migration, authoring, recovery, Trash,
  ownership/privilege and publication preservation contracts before merge.
- Native reading/source tests exercise zero-project capture, Arabic/Unicode exact
  anchors, source intake, native Qur’an progress/places, native Gutenberg versions,
  shared book notebooks and runtime-role grants.
- Synthetic cutover tests compare old bodies, IDs, snapshots, selectors and sealed
  publication inputs; exercise explicit collection mappings, loose-note independence
  and idempotent migration. The guarded 0025 rollback/reapply rehearsal preserves
  legacy bytes and refuses native activity or later migrations. No live owner DB
  was migrated or owner notes read for this work.
- Capture unit tests exercise held saves, newer typing, frozen lost-response retries,
  independent identities, manual naming and empty-draft behavior.
- The assembled browser test covers one sidebar, body-first capture, independent
  notes, optional collections, keyboard context resizing, the complete An-Nisa
  reader, capture/return with restored selected text and 390px overflow.
- The retained full browser regression passed source sizing/zoom, working-cache
  preservation, publication boundaries, exact passages, lexicon/citations,
  source intake, library behavior, mobile layout and private storage restrictions.
- Offline Ossie/schema validation and production frontend build pass locally. The
  [final #211 checks](https://github.com/justin-napolitano/islam-research/pull/211/checks)
  passed API-schema, PostgreSQL 17/18, browser and owner/public container validation.

Reproducible developer commands (synthetic data only):

```sh
PYTHONPATH=src .venv/bin/python -m unittest discover -s tests
PYTHONPATH=src .venv/bin/python scripts/export_api_schema.py --check
PYTHONPATH=src .venv/bin/python scripts/validate_semantic.py
npm test --prefix web
npm run build --prefix web
PYTHONPATH=src node web/scripts/review-connected-workspace.mjs
PYTHONPATH=src node web/scripts/review-workspace.mjs
```

PostgreSQL tests require the isolated `RESEARCH_TEST_DATABASE_URL` test database;
without it they skip and are not database evidence. Browser scripts own/clean their
synthetic Chrome profile and use an ephemeral port. The owner's reading preview and
its private state are left untouched.

## Explicit later gates

#42 remains actual hosted owner sign-in, two-machine save/recovery and backup/restore
proof; #146 remains real owner reading/usability acceptance. #185 remains Khattab
resource access/rights, #15 remains scholarly pilot reading. Broader #95–98/#38/#141
acceptance concerning Obsidian/archive round trips, complete agent/structured query
coverage, scholarly pilot demonstrations and richer graph work remains tracked in
those issues. Provider expansion, full Obsidian sync, embeddings, learned ranking,
whole-graph visual design and unconfigured GCP deployment are not claimed here.
