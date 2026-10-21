# Local linked pages and optional hierarchy

Owner request: 2026-10-20. Target: the installed local Electron app; hosted web and
cloud sync stay deferred. Extends #95/#97 and the local source delivery #227.

## Contract before implementation

- A page is an existing notebook entry, not a duplicate body, filesystem folder or
  new ownership boundary. Notes, questions and source-linked writing keep their
  IDs, Markdown, source/edition/selector anchors, revisions and recovery.
- Optional single parent per page; nesting never determines publication or access.
  Loose top-level writing remains valid. A parent page can contain writing as well
  as child pages. The one sidebar contains the collapsible tree; no nested app shell.
- Page breadcrumbs, child links, New subpage and a searchable Move action share
  the existing document surface. Reparenting changes independent placement metadata,
  not the note body. Root moves, retries and stale-placement conflicts are explicit.
  Reject self-parenting, ancestor cycles and nesting beyond 32 levels in PostgreSQL.
- Prepare a child creation UUID and parent intent before opening body-first writing.
  The first real note save and placement commit together; ordinary empty drafts are
  not fake saved pages. Recovery reuses the UUID/intent. A retry cannot reattach an
  already saved page that has subsequently moved.
- Trash never cascades. Children of an unavailable parent remain discoverable at
  top level; the original parent pointer is retained, and breadcrumbs explain the
  unavailable parent. Restore can reveal the original hierarchy again.
- Typing `[[` opens global, bounded page search; keyboard/mouse selection inserts
  `[[stable-page-id|Readable title]]`. Rename/move cannot change the target. These
  are ordinary Markdown navigation links, not scholarly evidence assertions.
- Reuse the maintained remark parser and CodeMirror editor. Ignore code, escaped
  tokens and existing Markdown links when offering completions. Selection inserts
  body text and its explicit notebook-entry link in the same autosave value; removed
  generated Markdown links are removed without erasing manually explained links.
- Linked-from views read canonical notebook links, preserving original IDs. Existing
  title-only `[[Title]]` links resolve through the whole active notebook on follow;
  ambiguous/missing titles remain explicit and never silently choose a page. Stable
  ID completion is the dependable rename-safe path. No automatic rewrite of legacy
  notes or promise of filesystem/Obsidian synchronization is introduced.
- All page APIs are registered by the trusted desktop service. Owner authorization,
  CSRF, body/rate limits and explicit write confirmation remain. Tree/search/backlink
  results are bounded and exclude trashed/withdrawn content; anonymous endpoints gain
  no page metadata or counts. Hierarchy history and pending intents live in PostgreSQL
  and participate in existing backups/restore. No dependencies or remote service.

## Acceptance and review

Use synthetic isolated databases and a separate native Electron window only. Verify
new child/restart/recovery, lost acknowledgement replay after a later move, cycles,
deep trees, stale/concurrent moves, duplicate titles, more than one page of results,
rename-safe stable links, aliases, code/escaping/IME, backlinks and removal, Trash/
restore, unchanged source anchors, undo and unsaved navigation. Check keyboard tree
expansion, narrow layouts and preserved reader state. Run PostgreSQL 17/18, relevant
frontend/API/privacy regressions, production build and copied-package native tests.

Security review applies to new authenticated APIs, grants and hierarchy triggers.
Primary threats: cycle/recursive-query denial of service, stale placement overwrites,
private title/backlink leakage and parsed-text injection. Bound traversal and query
results, enforce cycles/revisions in SQL, keep owner-only registration and existing
safe Markdown/CSP. Imported text remains data. This document records requirements,
not an assertion of external review or completed acceptance.
