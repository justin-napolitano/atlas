# Local note folders and sidebar movement

Owner request: 2026-10-20. Extends the local linked-page contract and PR #229.
Folders organize writing in the same left explorer; they are not synthetic notes,
projects, source containers or publication boundaries.

## Implementation contract

Each folder has a stable ID, name, optional parent folder, revision and immutable
history. Each note may have one parent page OR one containing folder. Existing
page nesting, Markdown, note IDs, citations, recovery and backlinks remain intact.
Folders cannot be children of notes. Folder depth is bounded at 16 independently
of the existing page depth of 32. Moving a folder moves its visible subtree;
relative note placement and bodies are unchanged. Root notes remain valid.

Use the single sidebar tree. Folder names expand/collapse their children; notes
open their existing document. Add folders inline, rename without a modal form,
and create a blank body-first note inside a folder using a durable preparation
intent. Drag notes onto pages/folders and folders onto folders; root is an explicit
drop target. Keyboard users get equivalent Move actions and focusable controls.
Sibling order remains alphabetical; reordering by arbitrary drag position is deferred.

All mutations are desktop-owner-only, revision checked, actor bound and idempotent.
A retry replays its original receipt without overwriting a later move. Reject
cycles, self targets and excessive depth in SQL. Deleting a folder is allowed only
when empty and must never cascade. Use tombstones/history rather than erasing IDs.
Trashed notes remain recoverable and retain their placement. Folder removal is
blocked while any note still refers to it, including a trashed note.

Backups retain folders, placements, pending creation intents and note links in the
same PostgreSQL snapshot. No filesystem folder mirroring, Obsidian vault sync,
cloud service or hosted web delivery is included.

## Verification

Synthetic tests cover folder nesting, rename, idempotent retries, stale moves,
cycles/depth, note/page/folder moves without body edits, empty-only removal,
Trash/restore, permissions and backup restore. Native review covers sidebar
creation, keyboard movement and drag/drop with actual persisted state.
