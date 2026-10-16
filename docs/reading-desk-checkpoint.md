# Reading desk checkpoint

This is the bounded software delivery under #85, not completion of the whole epic or scholarly pilot. The first useful loop is add/find a source → read → highlight → write → follow evidence → return → find the writing again.

## Implemented slices and review order

1. [#148](https://github.com/justin-napolitano/islam-research/pull/148): private notebook/question recovery storage, immutable baselines and revision checks.
2. [#149](https://github.com/justin-napolitano/islam-research/pull/149): active-page reference verification under delayed/reordered loading; merged separately after passing checks.
3. [#150](https://github.com/justin-napolitano/islam-research/pull/150): automatic private recovery and notebook Unfinished work.
4. [#151](https://github.com/justin-napolitano/islam-research/pull/151): bounded warm pages, protected unfinished tabs, and actual-save status.
5. [#152](https://github.com/justin-napolitano/islam-research/pull/152): reversible private writing Trash, Undo, and Restore.
6. [#153](https://github.com/justin-napolitano/islam-research/pull/153): retain one capture/recovery identity when changing the unfinished capture classification.

See [durable-writing.md](durable-writing.md), [working-tabs.md](working-tabs.md), and [private-writing-trash.md](private-writing-trash.md) for guarantees, limitations, migration/grant requirements, and verification. Preserve small reviewable changes. Do not mark a PR merged, a cloud workflow verified, or an issue complete solely because it appears in this list.

## A real 30-minute owner session (#146)

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
