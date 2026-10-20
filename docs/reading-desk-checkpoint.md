# Reading desk checkpoint

This is the bounded software delivery under #85, not completion of the whole epic or scholarly pilot. The first useful loop is add/find a source → read → highlight → write → follow evidence → return → find the writing again.

## Current status

The existing stack through #171 is merged. Main application/browser/container and
backend PostgreSQL 17/18 checks passed; see [merge reconciliation](merge-issue-reconciliation.md).
The active product roadmap is #84. A local candidate now supplies identified
complete Surahs 1 and 4 in Tanzil Arabic and a live, named QuranEnc English
translation, with continuous reading and exact private verse association. It has
not been merged, deployed, or observed in an owner reading session. The older
Q 4:59/4:83 and Sirry excerpts remain bounded reading aids.

## Merged foundation slices

1. [#148](https://github.com/justin-napolitano/islam-research/pull/148): private notebook/question recovery storage, immutable baselines and revision checks.
2. [#149](https://github.com/justin-napolitano/islam-research/pull/149): active-page reference verification under delayed/reordered loading; merged separately after passing checks.
3. [#150](https://github.com/justin-napolitano/islam-research/pull/150): automatic private recovery and notebook Unfinished work.
4. [#151](https://github.com/justin-napolitano/islam-research/pull/151): bounded warm pages, protected unfinished tabs, and actual-save status.
5. [#152](https://github.com/justin-napolitano/islam-research/pull/152): reversible private writing Trash, Undo, and Restore.
6. [#153](https://github.com/justin-napolitano/islam-research/pull/153): retain one capture/recovery identity when changing the unfinished capture classification.

See [durable-writing.md](durable-writing.md), [working-tabs.md](working-tabs.md), and [private-writing-trash.md](private-writing-trash.md) for guarantees, limitations, migration/grant requirements, and verification. Preserve small reviewable changes. Do not mark a PR merged, a cloud workflow verified, or an issue complete solely because it appears in this list.

## A real 30-minute owner session (#146)

The next acceptance session should use **Sources → Reading tools → Read the Qur’an**.
Do this after starting the owner workspace with its private PostgreSQL database and
authentication. The reader currently supports complete Surahs 1 and 4. Its Arabic
text is pinned Tanzil Uthmani 1.1; its English choices are provider-labeled Noor
International Center and Rowwad Translation Center via QuranEnc.com. The proposed
Clear Quran preference is not yet an available, verified reading resource. Provider
outage should leave Arabic readable with an explicit translation gap.

Record the exact build, browser, device, and provider resource/version displayed.
For approximately 30 minutes, try the following with your own private test notes:

1. Open Surah 4 at Q 4:59, read continuously, use direct ayah entry and next/previous,
   then reload a Q 4:59 deep link. Check comfortable Arabic and English type sizes,
   mobile width, keyboard operation, and screen-reader labels where available.
2. Write a free note on the Arabic verse without an import form. Highlight a short
   exact Arabic phrase, save a note on the named English translation, and switch
   translations. Confirm that the old highlighted wording remains attached to its
   original version and that missing translation is shown honestly.
3. Open the linked Q 4:59 commentary in the same contextual pane, inspect its
   attribution and exact passage, return to your note, and keep your reading place.
   A missing commentary is a coverage gap; do not fill it with generated prose.
4. Save the reading place, reload, and resume. Reopen the note through the same
   verse/resource; search for the writing and inspect its Markdown export with
   source identity. Leave one unfinished note, confirm recovery, and test a safe
   Trash/Undo/Restore operation.
5. If a save is interrupted or a second session edits the note, record the visible
   retry/conflict state and confirm both versions remain recoverable. Do not mark
   an uncertain save as confirmed.

Log attempted/completed/blocked steps, unclear status, lost place or writing,
readability and performance friction, and reproducible follow-up issues. Fix data
loss, blocked navigation and inaccessible core actions before expanding providers.
Fixture and database tests do not complete this owner observation.

The following older article exercise remains available for checking the existing
desk; it is not proof of complete Qur’an reading.

Use the built-in **Read the Sirry article** action in Sources → Reading tools. Its identified article is Mun'im Sirry, *Who Are Those in Authority? Early Muslim Exegesis of the Qur'anic Ulū'l-Amr*, DOI `10.3390/rel12070483`. The built-in representation is only the first four abstract sentences manually transcribed from the screenshot the owner supplied. It is not checked publisher extraction, the whole article, or a scholarly review. Review the displayed source/edition/rights basis before saving; use a lawfully accessible full article later if available.

The reading collection already supplies bounded attributed Q 4:59/Q 4:83 translation/commentary excerpts with locators and source-specific coverage limits. Keep them distinct from the article and the Arabic text. Do not invent commentary, glossary definitions, historical context, or findings to make this exercise look complete.

Suggested session:

1. Add/open the identified article excerpt. Confirm its locator, representation version, and visible limits. Find it again in Sources.
2. Select one sentence, highlight or underline it, and write a margin question in your own words. Save the actual annotation explicitly.
3. Write an independent Markdown notebook note and a working question. Connect one to the saved passage with a reason. Treat personal thoughts as personal; do not label an abstract-derived idea a reviewed full-argument finding.
4. Follow a passage citation or an existing verse/commentary connection. Return to the original reading/writing without losing place. Record any missing connection as a gap rather than assume it exists.
5. Leave an unfinished note until Recovery saved appears. Reload, open Unfinished work, inspect and recover it, then explicitly save the actual note. Failed/offline copies must stay visibly unconfirmed.
6. Search for a phrase you wrote and reopen the result. Export saved Markdown and inspect its source IDs/backlinks; export is not Obsidian live sync.
7. Move a saved private test note to Trash, Undo, then trash/restore through the persistent list. Check that the same note and passage links return. Mark a reading as read only when you intend that personal state.

Record the exact build/browser/device, tasks completed or blocked, save/navigation friction, observed responsiveness, and prioritized follow-up issue links. Keep private notes and licensed text out of public evidence. Fix data loss, blocked core actions, and inaccessible navigation before advanced feature expansion.

This session has not been performed merely by writing this checklist or running synthetic tests. The owner must actually perform it before #146 closes. The real scholarly pilot #15 and hosted identity/cross-device/public/backup gates #31/#33/#42 remain separate. The local loopback review adapter saves only on this Mac and does not establish hosted PostgreSQL or real owner sign-in.
