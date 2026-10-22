# Keyboard-first Markdown properties

Owner direction, 2026-10-21: write first, classify and connect from the keyboard.
This extends the unified workspace and freeform skills/principles contracts.

## Interaction contract

- Cmd/Ctrl+N creates a blank page. No required properties or classification.
- Optional YAML frontmatter remains part of the exact saved Markdown. At the top
  of a page, `---` then Enter starts a properties block. Suggest `type`, `tags`
  and `aliases`; preserve other YAML verbatim.
- `type:` suggests the existing note roles. Arrows select, Tab/Enter accepts,
  Escape dismisses. Valid type edits use the existing autosave request together
  with the body. Incomplete/invalid YAML still saves as writing, retaining the
  last valid role. Source claims keep the existing exact-source requirement.
- Tags and aliases are optional YAML strings/lists. Tags remain searchable in
  the saved body; typing a tag suggests tags from the currently loaded notes.
  Do not claim this is a complete workspace-wide tag index or alias resolver.
- `[[` uses existing server page search and stable-ID insertion/backlinks.
  Keyboard following must work without clicking rendered links.
- Cmd/Ctrl+Shift+M moves the cursor to frontmatter, adding a minimal block only
  when absent; it never replaces the document. Preserve undo and cursor sessions.
- No permanent metadata form, additional sidebar, assessments or stages.

## Owner amendment: /type — 2026-10-21

A standalone `/type` (or `/type sk`, `/type pri`) in the document opens role
suggestions. Arrows and Tab/Enter choose; Escape preserves the literal writing.
Acceptance removes only the command and updates/adds frontmatter in a single
undoable transaction; comments, unknown properties and surrounding writing survive.
Ignore code, HTML and unfinished frontmatter. Source claims still require the
existing exact-source workflow and are excluded from this freeform command.
The owner authorized a normal quit/reopen into the completed latest build.

Delivery: 179 frontend tests pass. Synthetic native acceptance confirms `/type`
classification from ordinary writing, preservation of surrounding text, stable
links, tags, undo/redo and exact reload. Frozen restart, CAS and backup/restore
checks pass. Installed the signed build at `~/Applications/Atlas.app`, retaining
the earlier stable bundle as `Atlas Previous 58bdc5f.app`. Normally quit the old
Atlas Keyboard.app and opened the updated stable app at the owner's request.
No owner note contents were inspected or used as test fixtures.

## Authority and preservation

PostgreSQL stores body, role, links and revisions using existing CAS, frozen
creation retries and recovery. No new browser persistence or owner DB fixtures.
Do not parse YAML as executable objects, permit aliases or fetch external data.
Bound header size and suggestions. Never rewrite unknown properties or comments.
Existing properties role controls must update a valid frontmatter type too;
malformed headers must remain untouched rather than silently overwritten.
Removing frontmatter does not silently reset the note role. Imported/server-side
Markdown is retained; this pass applies classification on editor changes, not a
global migration. Universal alias resolution and indexed tag facets are follow-up.

## Acceptance

Use synthetic notes: create via CmdN; add frontmatter; change note→skill→principle
with keyboard completion; edit tags; insert and follow an existing wiki link;
undo; navigate/reopen and verify body, role, stable link and revision. Invalid YAML,
duplicates and aliases must not apply a role or lose writing. YAML containing HTML
renders as text. Existing Arabic, tables, code, citations, frozen retry and conflict
tests continue passing. Verify popup placement, active option semantics, Escape,
IME and undo. New YAML/render parser dependencies need dependency review in PR;
no external approval is claimed. Keep owner app running untouched during testing.

## Delivery evidence — 2026-10-21

Issue #240, PR #241 (stacked on #239). Implemented in the existing live Markdown
editor and save requests, without a new database schema or content store.
178 frontend tests and the focused server title test pass; production build and
dependency audit pass. An isolated native Electron run verifies keyboard template
creation, skill→principle conversion, loaded-tag completion, stable wiki links,
Cmd/Ctrl+Enter navigation, undo/redo and exact body readback after reload. The
copied frozen service also passes restart/CAS and coordinated database/original-file
backup/restore, including corrupt/tampered restore rejection. These use fresh
synthetic databases and do not establish owner usability acceptance or cloud sync.
The separately packaged Atlas Markdown.app passes strict signature verification;
the running owner app was neither replaced nor restarted.
