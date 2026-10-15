# A bounded research reading session

This slice connects roadmap #84's first reading session and first context/notebook
features. It does not complete the academic wiki or claim a live deployment.

1. **Reading collection & context** contains five located readings for Q 4:59 and
   Q 4:83: two named historical Rodwell translations, brief al-Tabari quotations,
   and a brief Tabataba’i quotation in Rizvi's translation. Person/term preparation
   cards link their evidence. Source quotations, preparation paraphrases, editions,
   locators, rights basis and checked-evidence limitations stay separate. No full
   Sirry argument review, modern Muslim translation coverage or complete school
   history is claimed. See `located-reading-collection.md` and the pinned resource.
2. **Add this reading & take notes** opens the existing explicit intake review.
   Saving a matching excerpt offers a separate confirmed verse connection. The
   server verifies its exact document and source identity before atomically adding
   an anchor and pending translation representation or commentary discussion.
   Interrupted requests retain their original UUID; later notes/corrections are
   preserved. You can read without connecting it. See `collection-verse-link.md`.
3. **Save recoverable draft** saves unfinished record or passage writing privately.
   Reload, find the copy, compare its baseline/current note and recover it into
   the editor. Recovery never commits the actual note. Unsaved progress, newer
   confirmed revisions and other passage editors are protected from replacement.
   Captures retain their future annotation identity; an already committed capture
   reopens as an edit. This is explicit recovery, not autosave/offline sync or
   permanent erasure. See `recoverable-writing-drafts.md`.
4. **My notebook** combines current saved passage/record notes with separate typed
   private thoughts, questions and objections. Source claims need a saved passage;
   explicit connections need a reason. Existing reading bodies remain in their
   original tables. Search/filter, follow a backlink, inspect history, compare a
   conflict or withdraw a thought. Save unfinished notebook thoughts using the
   private Save thought action; unsaved notebook keystrokes remain in this tab.
5. **Compare readings** opens independent source/version panes. Both preserve
   edition, locator, notice and text hash; URL reload/Back retains their selections
   including cleared panes. Return from comparison/context to the originating
   saved passage. Q 4:59/83 collection filters survive reload and return from intake.
6. **Connections & source context / Follow the evidence** expose recorded directed
   links, their provenance and review limits. Pick a source's actual saved version
   to read/compare. A bibliographic locator alone is not an exact annotation anchor.
   No relationship is inferred from shared wording, proximity or citation counts.

All authoring APIs remain signed-owner only. Drafts, notebook thoughts, history and
new verse material do not become public merely because they were saved. The
canonical Turtle graph and editorial authority remain unchanged; prepared context
is pending owner review. Deployment and actual two-browser identity/recovery gates
remain #31/#42, including cloud bootstrap, real IAM grants, backups and rollback.

Verification combines actual pinned reading data and real PostgreSQL 17/18 tests
with compiled browser adapters. The latter exercise UI and failure/navigation
behavior, not a live IAP session. Existing public artifact isolation, container,
graph, semantic, API-schema and infrastructure checks remain required. No new
frontend dependency or local database/container daemon is needed.
