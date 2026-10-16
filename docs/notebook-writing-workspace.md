# Reading and writing as equal destinations

The owner workspace has two persistent destinations: **Reading** and **Notebook**. The notebook is a project-level writing surface that opens directly with `/workspace.html?project=PROJECT_ID&view=notebook`. It does not require a source or a reading selection. The existing source-based annotation and personal-notebook authorities remain separate.

## Flow

1. Open **Notebook** in the header. The source library gives way to a note index and a writing page. **Library** still opens project selection and reading tools. Search and agent briefs remain available in the shared header; theme and publication are in **More**.
2. Choose **New note**, enter a title, and write. Notes use the existing `note` thought type and store no source/document/passage anchor by default. Questions, interpretations, objections, and located source claims retain their distinct types. The explicit **Note on this reading** action makes an optional source anchor available.
3. **Save note** or Cmd/Ctrl+S confirms a save through the existing notebook API. The toolbar distinguishes unsaved edits, a pending save, a confirmed revision, and an uncertain acknowledgement. The existing UUID retry, revision conflict comparison, withdrawal/history, and in-page draft retention continue to apply. This pass does not add autosave or offline durable drafts.
4. Open **Connections** to search actual project research. Choose a result, explain the connection, add it, and save the note. Search does not write anything. Notebook thoughts link as entries, saved passage notes/definitions as annotations, concepts as concept records, and documents as their source records (explicitly labeled). No exact passage is invented for a document search result. ID-based linking remains an advanced option.
5. Open **Note details & history** for withdrawal, revisions, stable IDs, and Markdown export. Export includes only the last confirmed save and its source/link IDs; unfinished edits are explicitly excluded. Saved entry selections update the notebook URL for direct reopening.
6. On a phone, the note index and editor are separate views; **All notes** returns to the index. Desktop retains both side by side. Notes remain plain Markdown text, including inert HTML-looking content, with a readable measure, visible keyboard focus, RTL-aware text fields, and a sticky save toolbar.

## Validation and limits

`node web/scripts/review-notebook.mjs` exercises real compiled components against a labeled synthetic API, including independent note creation, explained search-based connections, uncertain saves, retries, conflicts, history, late acknowledgements, and mobile navigation. `review-workspace.mjs` and `review-research-tools.mjs` retain the reader, source, publication, search, and brief regressions. These checks and screenshot inspection do not establish complete accessibility compliance or hosted two-device behavior.

This is one notebook per existing research project, with independently addressable notes. It does not introduce a hierarchy of notebook collections, WYSIWYG editing, automatic Obsidian synchronization, model execution, new dependencies, API routes, migrations, or hosted deployment. Live owner writing still requires the configured authenticated PostgreSQL runtime; the loopback review adapter remains local-only.
