# Compact notebook explorer

Issue #165 replaces the notebook's tall introduction, category blocks, note previews,
type labels and count heading with a small toolbar and a file-explorer navigation.

Search sits above the current project folder. My writing, Reading notes and Everything
are collapsible views of the existing notebook collections; each shows the active
query's note titles. Long names truncate visually and retain their full accessible
names and hover titles. These are collection views, not user-created storage folders.
The project's durable identity and each note's original ID and source anchor remain
unchanged. Custom nested folders and moves remain #139.

Search updates after 250ms of quiet or Enter. Pending searches are canceled/rescheduled
when their query, project, folder or filters change, so earlier view criteria cannot
replace current results. List and entry requests use separate generations: finding
notes does not invalidate opening the selected document. Filtering still happens on
the server before pagination. Pagination remains available inside the open collection.

Notebook tools contains private recovery, Trash and advanced filters. Recovery failure,
conflict and uncertain-write messages in the document remain visible. Reading-note
entries continue to open their verified source context; Questions, Markdown, automatic
saves, wiki links, graph access and mobile note/editor navigation retain their behavior.

The workspace-only large serif Notes heading was removed so the compact 16px heading
works in the full application as well as the component harness. The empty editor now
offers one short prompt instead of an introductory essay.

Validation covers real folder collapse/expand, title-only rows, live search and clear,
saved-note visibility after filter changes, full-app heading size, mobile reflow,
and the existing private writing, recovery, conflict, exact-citation and Trash flows.
This pass introduces no backend, schema, external integration or dependency changes.

The library/reader/research product direction is in
[research-library-vision.md](../research-library-vision.md). arXiv full-paper reading
and review is planned in #166; it is not supplied by this navigation change.
