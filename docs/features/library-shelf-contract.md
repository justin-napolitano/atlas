# Library shelf and book notebook contracts

Status: planned, not implemented. Owner direction: 2026-10-19. Implementation must
follow the [design brief](../design/library-shelf-brief.md) and resolve the
[shared-library ADR proposal](../adr/0004-shared-personal-library.md) under #101.
Tracking: epic #194; #101 identity, #195 shelf, #196 discovery, #95 notebook,
#197 integration acceptance and #146 owner session.

Existing Gutenberg reading #191 and note-location #193 are separate implemented
slices; neither establishes a cross-project personal library by itself.

## Information architecture and identity

One owner library spans projects. One saved-work row opens a concrete preferred
edition; verified alternative editions are secondary. Unknown work equivalence stays
separate. No provider/work/translation merges from title similarity. Source identities,
edition/representation IDs, library membership, project associations and notes are
different entities. Existing canonical RDF and private/public authorities survive.

The shelf is a reading view of the library, not a declaration that every reference
is a readable book. Metadata-only sources stay useful in Sources. Supported papers,
files and other structures can later use the same library identity contract without
pretending PDF/EPUB/arXiv support is already present.

## Interaction contract

| Trigger | Result | State preserved / side effects |
| --- | --- | --- |
| Open Library | Continue reading plus saved-work list; same left sidebar | Existing working drafts remain owned outside views |
| Select book title | Open preferred edition at last confirmed location, or beginning | No intervening dashboard, implicit completion or publication |
| Select note count / Notes | Open primary book notebook beside its last-used source where readable | Same note IDs/revisions as main Notebook; zero-note opening creates no saved empty entry |
| Find books | Replace main list with catalog discovery; Back restores shelf/filter/scroll | No second shell or mandatory provider menu |
| Search saved books | Search owner library only | No provider request or transmission of private text |
| Submit catalog search | Query connected providers through existing bounded adapters | Explicit external search; no private note bodies in provider requests |
| Open available catalog result | Read immediately, before adding membership | May cache permitted text; no shelf item, read/completed status or reviewed claim from browsing alone |
| Save result | Idempotently retain library item and selected edition | No duplicate on retry; no mandatory project selection |
| First successful note save | Atomically retain library association, stable target and actual note | Retain immutable creation UUID/payload, exact anchors and newer typing |
| Add to another project | Add association to same item/note as requested | No cloned text/notebook or silent exposure |
| Choose another edition | Deliberately open named edition and its own saved place | Existing notes remain bound to original versions; never move highlights |
| Follow passage backlink | Reveal exact original version/locator beside writing | Back restores writing/cursor and prior reading context |
| Remove from project / shelf | Remove that association / shelf membership | Writing/history/anchors remain available; no cascade deletion |

If the default representation is unavailable, keep the chosen edition visible and
offer an explicitly named alternative or provider link. Never silently substitute
another text. A metadata/provider-only result cannot expose inline highlight tools
over an external viewer the app cannot anchor.

## Shelf result and query contract (logical, not shipped API routes)

Each owner-authorized paginated row supplies stable library/work identity, selected
edition/representation identity if known, title, responsible people, language/translator,
honest availability, library state, saved resume target, relevant note count and
timestamps/revisions needed for deterministic ordering. Omit or label unknown fields;
do not fill missing print publication dates from digital release dates.

Default list: recently explicitly/automatically retained first, stable ID tie-break.
Continue reading: at most five items in Reading with a successfully saved reading
place, ordered by server-confirmed reading activity, stable ID tie-break. Showing a
view or editing a note does not change reading recency. Show all uses the same list.
Filters are Reading / Want to read / Finished / All, with All initially selected.
All excludes removed shelf memberships; a note still remains findable in Notes.

Reading state begins Want to read when explicitly saved without reading. A real
successful reader-place update may move Want to read → Reading. A first source note
without reading retains the book but does not claim it was read. Finished requires
an explicit mark or an existing structure-specific verified completion rule; scrolling
or jumping to a final section is insufficient. Reopening Finished does not silently
undo it; Start rereading is explicit. Scholarly review is wholly independent.

Resume is edition/version + structural locator/Unicode position, not a page count
invented for plain text. Display canonical surah/ayah for Qur’an, paragraph/section
for supported prose; use a neutral location when unknown. Show completion only when
its denominator and read rule are supported. Resume and furthest-read are distinct.

Return bounded cursor pages (target default 30, maximum 50), avoiding per-row note
requests. Filter/search/count permission checks occur server-side before results
are computed. Draft rows never masquerade as confirmed saved data. If an eventual
API needs snapshot-consistent cursor ordering, define the cursor/recency policy in
#101 rather than quietly allowing duplicates/missing rows during concurrent changes.

## Notes and book notebook

An optional primary Book notebook is a standard live Markdown entry attached to
the library work. It is created on first meaningful write, unique for that owner/book
association, with an idempotent creation transaction. Independent whole-book notes
and questions remain separate standard entries. No required summary/rating template.

Book-level writing need not choose an edition unless its claim/citation depends on
one. Exact and location notes always retain their original edition/version. In a
work-level notebook, passage material is grouped by edition and then structural
location. Choosing a preferred edition does not hide other-edition notes without
an explicit visible filter. Legacy project-scoped notes retain their scope.

The same entry appears in the main Notebook, book notebook and associated project
views with the same ID, body and revision. Opening another view is not a copy or a
new save. Questions retain their type/state; an open question is not an answered
finding, and a personal interpretation is not an attributed scholarly claim.

The Notes count means distinct active, visible written notes plus questions linked
to this book: primary notebook, independent entries and passage annotation bodies.
Count one identity once even when present in several projects or categories. Exclude
empty drafts, quote-only highlights, Trash and withdrawn entries. Quote-only marks
remain visible under Highlights and can have a separate labeled count there. An
annotation body is not counted again as a virtual notebook projection. Preserve
permissions before counting; public availability does not authorize private counts.

## Save, revision and recovery invariants

- The first-note transaction owns library retention, stable source/representation
  target and note creation; if it fails, neither a falsely saved note nor a phantom
  user-visible library item is shown. Existing durable recovery may retain a private
  target before actual note success, labeled as unfinished work rather than a read book.
- An explicit shelf removal is remembered. Autosaving/editing retained notes must
  not silently restore membership; re-add requires explicit Save/restore. First-note
  retention applies to a new library association, not overriding a removal decision.
- Frozen UUID/payload retries must return the same IDs. Concurrent first-note and
  explicit Save requests converge on one library item and retain each distinct note.
- Newer typing survives delayed acknowledgements, pane hiding, project navigation,
  cache suspension and reload under the existing recovery authority. Saved means
  the exact currently displayed content is confirmed.
- Notebook edits, state/membership changes and resume use server revisions/CAS as
  appropriate. A competing device preserves both choices; no client-clock overwrite.
- Store authority is hosted PostgreSQL through owner APIs. Local preview JSON is
  a review adapter, not evidence of cloud sync. Browser storage holds presentation
  preferences only, not another private note/library database.
- Preserve old links, annotations, text hashes, canonical graph IDs, provenance,
  Trash and revision history through #101. Source changes require explicit anchor
  review, not moving an existing quote onto changed text.

## Presentation, cover and accessibility invariants

One sidebar; one document surface; optional adjacent context. No second explorer,
large tab strip, provider wizard, book dashboard detour, permanent writing modes,
or administrative field form in the reading flow. Reuse semantic theme tokens and
current font/size controls. Limit rendered rows and lazy-load bounded cover images.

Covers are optional and decorative: title/author remain sufficient, and missing
or failed images do not block reading or jump the row layout. Provider image rights,
attribution, allowed HTTPS origins/routes, MIME/size limits and privacy-safe caching
need review before automatic cover fetching. No arbitrary remote-image proxy or
provider tracking requests on every shelf render. An existing accessible book icon
is sufficient until verified covers exist.

Primary row/title and Notes are distinct reachable controls. Enter opens the focused
target; labels identify book and edition. Do not interfere with native Space/Arrow
behavior in writing/controls or existing Qur’an advance shortcuts in reading. Restore
focus after discovery/context dismissal. At 390px and 200% zoom there is no horizontal
page overflow, nested navigation, clipped primary action or inaccessible notes link.
No interaction requires hover, cover recognition, color alone or AI.

## Failure states and acceptance evidence

| Case | Required behavior / evidence |
| --- | --- |
| Empty library | Quiet Find books action; no giant welcome dashboard or fabricated example books |
| Library/network/auth error | Distinguish empty, loading, unavailable and sign-in; retry preserves query/filter/draft |
| Catalog provider failure | Existing library still opens; errors identify coverage without leaking raw provider/private payloads |
| Two editions/translations | Correct selected edition; notes, resume and progress remain version-specific |
| Two projects | One library item and note identity; explicit scope; no duplicated counts or publication |
| Lost response / concurrent first save | Same UUID retry; exactly one membership; all legitimate notes retained |
| Slow save while typing / view switch | Latest body/cursor/draft survives; honest Saved/error status |
| Competing device | Both versions/places available; explicit choice and CAS verification |
| Changed/missing source | Original saved quote retained; unavailable/unresolved target explained; no retargeting |
| Shelf removal / project archive / Trash | No lost writing; membership removal and note Trash are distinct, restorable actions |
| Anonymous view | No private library, notes, counts, reading history or traversal leaks |
| Legacy migration and rollback | Old source/note URLs, Unicode anchors, revision/recovery IDs and explicit publication resolve correctly |

Before delivery record real PostgreSQL 17/18 migration/API/isolation results,
synthetic assembled browser/keyboard/mobile/200%-zoom checks and the owner flow
under #146. Automated checks use synthetic writing and an isolated port; do not
read or publish owner local-preview state. Hosted two-device/backup proof is #42.

## Ordered delivery and boundaries

1. #101: reconcile the identity ADR, migration/rollback and APIs before schema work.
2. #195 shelf/navigation slice: actual saved rows, reading-state semantics, Continue,
   shared/project filtering and direct reader/Notes targets.
3. #196 discovery slice: Find books, accurate edition/availability selection, Open/Save,
   first-note retention; reuse Gutenberg #170/#191 and catalog #168.
4. #95: primary book notebook, linked existing notes/questions, global Notebook
   projection, exact source/context return and recovery.
5. #197 cross-flow validation plus #146 owner reading and #42 hosted proof when configured.

No frontend, backend, database, dependency, migration or preview changes in this
planning pass. Additional providers (#169/#166), full Obsidian sync (#40), arbitrary
folders (#139), graph redesign, recommendations and generated summaries are deferred.
