# Reader interface samples

Three isolated, interactive design studies make the source text the starting point. They do not replace the hosted workspace or its PostgreSQL, authentication, revision, editorial, or publication contracts.

Run `npm run dev:samples` from `web/`, then open `http://127.0.0.1:5181/samples/`.

| Sample | Main question |
| --- | --- |
| Reader | Can you read and annotate without leaving the page? |
| Study desk | Can you move between a verse and its named commentaries without losing context? |
| Notebook | Can your questions and observations accumulate with links back to the source? |

Use the same task in each: open Q 4:59, select a phrase, save a question about it, follow a related reading, and return from the note to the quoted passage. Reload to check saved notes. Check the layout on a narrow screen and switch to dark mode.

The five exact excerpts and their source metadata come from `src/islam_research/resources/reading-collection-v1.json`; the generated sample data retains the collection's preparation notes, source notices, and pending review status. These are short reading aids, not complete works or a newly verified scholarly corpus. Shared-verse navigation establishes a verse connection only, not agreement or evidentiary support.

Each sample keeps its own notes and preferences in this browser's local storage. They are not uploaded, merged with the owner database, shared between samples, or synchronized to Obsidian. Clearing browser storage removes them. This is a prototype boundary, not the persistence design for the actual application. Do not interpret a prototype save as a PostgreSQL or authenticated multi-device test.

`npm run build:samples` produces a separate `web/dist-samples/` artifact. The normal public and owner build entries do not include these pages. The sample server binds to loopback and does not implement owner API or publication routes. Gallery images are screenshots of these working samples, not mockups.

The sample build checks that its generated data exactly matches the located collection bytes. After a deliberate collection update, run `npm run refresh:samples` from `web/` and review the resulting data diff.
