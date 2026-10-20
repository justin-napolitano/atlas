# Connected workspace interaction and acceptance contracts

Status: owner-approved contract; implementation #207–211. Epic #201.
See [delivery and verification status](connected-workspace-delivery.md).
Read [vision](../connected-research-vision.md) and [ADR 0005](../adr/0005-connected-owner-workspace.md).
This supersedes project-required navigation and project-owned writing as the target
product model. Existing identity/save/editor/reader invariants still apply.

## Primary flows

| Trigger | Result | Side-effect boundary |
| --- | --- | --- |
| New note / capture shortcut | Blank body focused, private independent draft | No required title/project/source/collection/type or AI |
| First meaningful writing | One stable note, quiet acknowledged autosave | Frozen create UUID/payload; no duplicate after lost response |
| Blank draft dismissal | Return to prior surface | No permanently saved empty note; other drafts preserved |
| Capture while reading | Independent writing with a clear return | Preserve source edition/location/selection and margin draft; no automatic citation |
| Return to reading | Same confirmed version/location and active writing | No read/completed/review state fabricated from navigation |
| Open recent Notes / global search | Find loose or connected writing | Filing and semantic processing are not prerequisites |
| Rename note | Owner-chosen display title retained | Derived first-line title never overwrites a manual name |
| Insert [[link]] | Resolve existing object or explicitly handle missing target | No duplicate source/concept from title matching or implicit evidence claim |
| Develop a question/decision/principle | Optional role change or linked extracted record | Preserve original note, previous content and revision; classification never publishes |
| Add to collection | Reference the same object | No body/progress/annotation copies or access grants |
| Save search/view | Persist supported query definition | Results remain live, permission-filtered objects |
| Remove collection/view membership | Remove organizational reference | Never delete writing or reset reading/review/publication |
| Open question | Investigation document with relevant linked context | Owner-controlled state; source count/agent text does not answer it |
| Follow passage | Original version/locator beside writing | Missing/changed targets explicit; no retargeted highlights |
| Explore current item | Bounded neighborhood and readable relationship list | No global graph crawl or automatic accepted similarity edges |
| Change interpretation | Retain dated versions and reason/source links | Preserve earlier wording and uncertainty; no retroactive source claims |

## Capture and durable writing

- Body-first creation; full existing Markdown/Unicode/RTL/IME/paste/undo behavior.
  A derived title is a bounded display label, never a rewrite of the Markdown.
- One persistent New note control and an app-scoped keyboard shortcut selected after
  browser/OS/editor/reader collision checks. Do not hijack browser Cmd+N or the reader's
  existing annotation shortcut. Mobile has an equally direct control.
- No forced Inbox, source attachment, tag picker, thought-type dropdown, summary,
  classification, agent call or template. An unlinked note is a valid finished object.
- Each independent capture has its own draft and eventual note identity. Existing
  unsaved writing survives a second capture and navigation.
- Newer typing survives slow acknowledgements; Save means the exact current content
  is acknowledged. Frozen retry inputs, expected revisions, explicit conflict choices,
  honest failure/unsaved status and durable recovery remain mandatory.
- Emptying an existing note must not acknowledge an older body. Existing explicit
  Trash/recovery semantics survive. Never silently discard a meaningful draft.
- Hosted PostgreSQL remains application authority. Presentation preferences may use
  browser storage; no second private content store. Local JSON preview is not proof
  of cloud sync. Offline inability to save is shown honestly.

## Connections, investigations and semantic retrieval

Personal associations may be lightweight and tentative. Relations asserting support,
challenge, definition or historical influence require appropriate rationale, attribution,
source locations and editorial status. An untyped personal link is not scholarly
support. Group membership and query matches are organization, not evidence edges.

Question documents gather existing records, linked passages, objections and provisional
answers. Writing and sources exist independently of the question. Removing a link
removes that relationship only. Owner-selected question state stays distinct from
reading completion, confidence, familiarity, agreement and scholarly review.

Global literal search and recency ship before optional embedding infrastructure.
Reuse #38/#34/#36/#37 for application-state retrieval, Apache Ossie semantics, versioned
ranking and bounded traversals. Search/agent results retain exact IDs, versions,
locators and provenance. Any semantic index is a derived revision-aware projection;
show coverage/staleness and preserve lexical fallback. Suggestions are attributable
proposals with explicit acceptance; do not infer consensus or confirmed connections.

## Organization and navigation

One sidebar: Continue, Library, Notes, Questions, Explore, optional collections.
Search, New note, settings and truthful sync status have one destination each.
Use the existing document/editor/source-context shell and semantic color tokens.
No required project creation/switching, second header, default project masquerading
as global ownership, nested notebook tree or large graph as a mandatory landing page.

Manual collections and saved views are different: collections explicitly associate
items; views store versioned bounded queries. Both can overlap. Neither owns content,
changes an item's scholarly type or grants publication rights. No arbitrary nesting
or block-database framework is needed for the first reset.

Recency uses actual confirmed note/reading updates, not unrelated view impressions.
Continue shows useful work, not decorative metrics, streaks or fabricated completion.
The previous page/cursor/selection and unfinished source context survive opening links,
capture, collections and Back/Forward. Keep a reachable list alternative to graphs.

## Migration and access acceptance

#202 must inventory actual authorities, resolve additive global ownership and aliases,
and rehearse cutover/rollback on synthetic PostgreSQL 17/18 before schema deployment.
Retain stable IDs, original project-qualified deep links, source/edition hashes,
Unicode selectors, note/history/recovery/Trash identity, reading signals and public
approval artifacts. Unknown duplicates and competing progress remain explicit.

The owner authorized a direct product reset. This does not authorize loss of writing
or silent equivalence claims. Existing groupings may become optional collections
through explicit mappings; compatibility aliases are implementation details.

All private retrieval, counts, traversal endpoints/intermediates, drafts and exports
remain owner-authorized. Collection membership is not an ACL. Collection deletion or
source reuse cannot publish private writing. Canonical curated RDF authority remains
unchanged until a separately validated authority migration.

## Required demonstration

1. Open a workspace with no collection/project; capture an untitled unrelated idea.
   Reopen it from recent Notes and literal search, without metadata or an agent.
2. Read Q 4:59 in the chosen resource; keep a margin draft and a text selection.
   Capture an unrelated thought, type during a held save, return to the same reading
   context, reload, and confirm both drafts/notes retain their exact identities.
3. Lose a creation acknowledgement and retry the frozen request. Exactly one note
   exists. A real competing edit preserves both versions for explicit resolution.
4. Optionally relate that note to a question and a philosophy source; use the same
   source/note in Islam and Political authority collections. Edit once, see the same
   revision everywhere. Removing either collection loses no content.
5. Explain one personal association and one sourced claim relation. Inspect both
   directions, a missing target, a cycle and a changed edition. No inferred accepted
   link, retargeted quote or auto-answered question.
6. Record a changed principle/decision with why and source references. Inspect the
   earlier wording, revision times and uncertainty without conflating historical dates.
7. Verify keyboard focus/return, live Markdown, 390px and 200% zoom on the assembled
   app; bounded queries/performance on older hardware; truthful loading/auth/offline/
   conflict/empty states; anonymous denial including counts and semantic results.
8. Exercise legacy links and synthetic migrate/rollback/retry/export mappings. Real
   two-machine save/recovery/backup evidence remains #42, owner reading remains #146.

This contract governs implementation; the delivery ledger distinguishes code/test completion from hosted deployment and owner acceptance.
