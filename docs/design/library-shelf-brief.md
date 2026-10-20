# Personal library and book notebook: design brief

Status: owner-approved product direction; planning only. No shelf UI, schema or
API implementation is authorized by this documentation pass. Date: 2026-10-19.
Tracking: epic #194, shelf #195, discovery #196, notebook #95, identity #101,
validation #197, owner session #146.

Read with the [interaction/data contract](../features/library-shelf-contract.md)
and [shared-library ADR proposal](../adr/0004-shared-personal-library.md).
The [unified workspace brief](unified-workspace-brief.md) still owns the shell.

## Outcome

Open the library, resume a book, write, follow a source, and return without
thinking about which application or project owns the screen. The owner selected
a compact list with small covers, direct reading, and a notebook per book.

One left sidebar persists. Library is the shared owner library; projects are
research contexts using its books and notes. A project may filter the shelf;
switching projects never copies the book or silently relocates writing.
Keep Sources for broader references (including metadata-only records), Questions
and Notes reachable. Do not put another global header or navigation tree inside
the library. This adds a library destination, not a replacement application shell.

## References and what to borrow

These are specific behavioral references, not dependencies or instructions to
clone their entire interfaces. References were researched in this conversation.

| Example | Borrow | Adapt to this product |
| --- | --- | --- |
| [Apple Books reading/Continue flow](https://support.apple.com/en-qa/guide/books/ibks5f526382/mac) and [collections](https://support.apple.com/en-asia/guide/books/ibks33867842/mac) | Recognizable personal library, Continue reading and simple reading states | Compact rows with small covers; title opens reading immediately; no store-style hero or large cover wall |
| [Readwise Reader default views](https://docs.readwise.io/reader/guides/filtering/default-views) | Useful Continue reading and filtered library views | Our explicit reading/resume authority defines eligibility; do not copy its numerical progress threshold |
| [Zotero notes](https://www.zotero.org/support/notes) | Source-linked notes plus independent notes in the same library | The same Markdown entry appears through book/project/main Notebook views; avoid a bibliographic form as the opening step |

The existing Obsidian/Bear direction remains: document-first writing, quiet
typography, minimal controls. Source rigor and stable references remain visible
where needed; personal notes never imply scholarly verification.

## Library screen

Continue reading is a small section above the library list, at most five recent
eligible books with a Show all route using the same list. The list below uses
title, author, selected edition/translator when relevant, semantic last location,
and a note count. Small covers are secondary recognition aids; absent covers do
not delay opening or leave a large empty card. Use a typographic book icon from
the existing icon system when a cover is missing. No decorative generated covers.

Use Reading / Want to read / Finished / All as compact inline filters, default All.
Continue reading is based on actual saved resume activity, never merely browsing
a search result. No percentage is fabricated for unsupported structures.
Show recent reading first in Continue; default the full list to recently saved,
with deterministic tie-breaking. Sorting details live in the contract.

One Find books action replaces catalog search embedded permanently above personal
library rows. Clicking it opens discovery in the same main surface. Keep library
search distinct and clearly labeled as searching saved books. Do not silently
send private notebook terms to a provider.

## Book selection and reading

Click title/row primary target: resume the selected edition at its saved location,
or its beginning when no location exists. No intermediate dashboard.
Click note count: open the book notebook with its source beside it when readable.
These are separate keyboard targets, never nested buttons or a row handler that
also fires when selecting Notes. Show Notes even at zero; do not create a saved
empty notebook just by opening that view.

Discovery rows show title, responsible people, language/translator and actual
availability. Open reads a supported text immediately. Save explicitly adds it to
the shelf. The first successfully saved note retains the book automatically.
Other editions is a secondary disclosure; never select an edition by title
similarity alone or substitute another translator without saying so.

## Book notebook

The optional running Book notebook is ordinary Markdown writing, without preset
Summary/Argument/Rating fields. Preserve independent notes and questions; a book
notebook does not force all writing into one giant document.

From the same adjacent context surface, inspect book notes, passage notes/highlights
and linked questions. Organize passage material by real chapter/verse where known,
then by source position; always retain edition/version when needed to disambiguate.
Selecting a passage note reveals its original text/version beside the writing.
The main Notebook and book view edit the same IDs, bodies and revisions.
No permanent Write/Preview buttons, Thought type dropdown, duplicated notebook
explorer, dashboard cards, or counts-only landing page.

## Presentation

Use the established charcoal canvas/sidebar, ivory text, neutral hover and restrained
red accents from the unified brief. Start shelf title text around 16–18px, secondary
metadata 13–14px, covers about 40×60px, and practical row height 76–96px; verify
in the assembled app rather than treating these as fixed at every zoom level.
Respect existing reader and note typography preferences independently.

At 390px, retain title, author, meaningful location and a reachable Notes target;
secondary edition details may wrap. Use the existing drawer and context-sheet
behavior. At 200% browser zoom, controls must remain readable and reachable.
The whole shelf uses bounded/paginated data, not one mounted row per catalog book.

## First-pass owner walkthrough

Use synthetic writing for automation and a separate test port. Open the shared
library → resume the Qur’an → open its notes → return to the same ayah → find
Plato → open a supported edition without saving → write a note → see it on the
shelf → add it to two projects → edit once through the main Notebook → reopen
the same edition/quote from either context. Include an empty library, two editions,
a missing cover, unavailable text, loading failure and an interrupted save.

The contract defines exact acceptance and migration gates. Passing automated
checks does not complete the owner's reading session (#146) or hosted release (#42).
