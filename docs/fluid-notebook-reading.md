# Write and explore a passage in one workspace

Notebook source navigation stays inside the notebook. A reading-note row, an anchored-note link, an explicit source/passage connection, or an inserted passage citation opens **Alongside your notes**. The existing editor remains mounted, with its unfinished body and caret retained. On desktop the source has its own scrollable panel; on mobile it is an overlay with an explicit close control. Closing restores focus to the triggering control. **Open full reader** is the explicit route-changing action.

The panel uses the existing immutable-document SourceReader and shared revision-aware passage-note editor. Its bookmarks do not replace the notebook URL. Revealing a passage scrolls the contained source rather than calling page-wide scroll navigation. Selecting a different edition updates the panel's local reading context; expanding uses that edition. Source text, translations, notes, concepts, and review state retain their existing authorities.

## Quote while writing

With a note open, select up to 500 exact Unicode characters in the source and choose **Quote in notebook**. The owner action creates a private, unmarked saved passage through the existing annotation API. The notebook verifies the creation response and exact anchored readback before appending a Markdown quotation, a located `research-passage:` citation, and an explicit annotation connection. The quote is escaped so Markdown punctuation and HTML-looking source text render literally. The note itself remains unsaved until **Save note**.

An uncertain annotation response retains the original UUID and payload in the shared page-memory draft map. **Retry original quote insertion** reuses those exact values; the browser regression proves a lost acknowledgement creates one passage. If the owner opens another note during the request, its body is not changed; returning to the original note allows retry. Pending insertion pauses edits/saves of that note; **Keep note without inserting quote** clears the insertion draft without deleting any potentially committed source passage. Source notices, edition information, and immutable version details remain available through the linked reading; private writing is never automatically published or reviewed.

## Organization

The owner notebook starts in **My writing**. **Reading notes** shows live passage and record annotations, and **Everything** combines both. These are views, not newly invented folder metadata. The signed-owner `notebook/items` endpoint accepts `item_scope=writing|reading|all` (default `all` for existing callers), filtering before ordering and pagination. Existing type, query, withdrawal, and cursor filters still apply. Creating a new independent note returns to My writing and clears conflicting filters.

No migration, new dependency, public API, or hosted deployment is introduced. This pass does not add custom folder hierarchies, autosave, or hosted synchronization. The local review adapter remains explicitly local-only. Unit/API tests cover quote identity, literal rendering, filter validation, and schema; the real PostgreSQL CI matrix covers filtering before pagination. Browser checks cover editor/route preservation, organization, uncertain quote replay, exact citation reopening, and the mobile overlay alongside the existing reader/notebook regressions.
