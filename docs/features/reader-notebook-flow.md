# Reader and notebook flow cleanup

Owner approved the screenshot review on 2026-10-20. Epic #231; implementation
slices #232 (reader), #234 (notebook), #233 (navigation/acceptance). Stack on #229.
Target is the installed local Electron app; preserve the shared reader and web
contracts. No hosted deployment, cloud sync or new dependency is included.

## Interaction contract before implementation

1. Opening a readable source presents a compact title/creator header immediately
   followed by text. Reference-only items retain their honest no-text flow. Source
   information contains bibliography, original URL, attachment/edition choices and
   connections; those tools do not occupy a large introductory screen.
2. Use one continuous main reading column and one optional resizable notebook.
   Keep working text/font/zoom/page preferences. Continuous mode has one main
   document scroll; explicit page-step mode may retain its own viewport.
3. One notebook presents existing exact passage notes, approximate location notes,
   and whole-source writing. A free thought defaults to the current reading
   location; selecting text opens quote-linked writing in that same panel. A quiet
   whole-source action reveals book-wide writing. No second editor below the book.
   Existing unfinished editors remain visible/reachable even when switching scopes.
4. Preserve all note bodies, types, IDs, origin/project contexts, source/document
   hashes, Unicode selectors, creation UUIDs, autosave queues, CAS conflicts,
   recovery, Trash and review/publication status. Presentation does not merge
   note authorities or silently manufacture an exact quote anchor.
5. Markdown formatting is enabled for verified imported Markdown document IDs from
   the existing private artifact metadata API. Other texts stay literal. Use the
   maintained remark parser. Preserve every original character in DOM text order,
   including hidden syntax, so existing source selection/offset contracts remain
   exact. Never replace the stored source with rendered text. Ambiguous/decoded or
   unsupported constructs stay literal; Original Markdown remains available.
   Images/HTML remain inert; safe links require explicit activation. Format only
   structures with provable source ranges and verify Arabic/emoji/graphemes.
6. Library and Notebook are primary navigation, with the same folder/page explorer.
   Continue, Questions, Explore, saved views and collection creation remain reachable
   through a compact secondary disclosure. Hide empty Collections; never lose its
   create action. Preserve direct routes, global search, pending work and storage truth.
7. Following a saved quotation scrolls to its exact source position inside the
   current workspace. Returning from notes preserves reading place and unfinished
   writing. At 390px the notebook is a dismissible sheet; focus returns to the
   triggering control. Test 200% text sizing and keyboard controls.

## Preservation and verification

Use synthetic fixtures and isolated PostgreSQL only. Do not reload or replace the
owner's active reader, inspect personal note bodies, or use live state as a test
fixture. Keep the current installed app intact while preparing a separate review
build. Commit working slices, maintain the stacked PR, and record actual evidence.

Tests must cover exact DOM/source text equality, selectors across formatting,
Unicode boundaries, marks and raw fallback; source-wide and located-note editing,
pending drafts while hiding/changing panes, source/version isolation, resume,
keyboard/mobile layout, default hosted/public regression, and native offline
restart/backup restore. Source originals remain immutable.

## Security scope

Private writing and untrusted imported Markdown retain their existing owner-only
API boundaries and safe rendering/CSP. No auth, grants, endpoints, external services
or storage schema changes are planned. Relevant risks are script/URL injection,
unintended external image loads, anchor corruption and draft loss. Reuse the parser,
keep syntax/source ranges, use inert fallbacks and synthetic tests. Flag any actual
new sensitive API/parser boundary for normal review; this plan is not an assertion
of external approval or completed acceptance.

## Delivered behavior and evidence

Implementation: [PR #235](https://github.com/justin-napolitano/islam-research/pull/235),
stacked on #229. Source metadata and edition/file controls are in Source info;
readable text follows the compact header. Reference-only items still support
writing before an import. The one resizable notebook contains current-location
writing, source-wide writing and exact passage notes. Unfinished writing survives
scope/navigation changes. Library/Notebook are primary; Research retains Continue,
Questions, Explore and collection creation. The existing folders/pages stay intact.

Verified before packaging:

- Frontend unit suite: **174 passed**, including exact Markdown source-range
  reconstruction and Arabic/emoji Unicode boundaries. Production build passed.
- GitHub browser suite, public/owner containers, lifecycle and storage boundaries:
  passed on implementation commit 4271be0 and documentation/harness update
  c1c6f15.
- Copied frozen bundle, sandboxed native Electron and a fresh isolated PostgreSQL
  database: reference creation, source-wide autosave, Markdown import, inert
  HTML/images, exact DOM/source equality, formatted phrase selection, inline quote
  reopening, location-note save and unfinished book writing across navigation.
- That native run also passed Unicode note persistence, Qur’an place/progress,
  restart, revision conflict rejection, database-plus-file backup/restore and
  corrupt-object/tampered-archive rejection. No owner data was modified.
- Final ad-hoc signed package: copied resources and sandboxed native Electron
  passed the same workflow at true 390px width, 200% text sizing, Original Markdown
  with retained marks, keyboard notebook resizing and mobile dismissal/focus return.
  The complete fresh-database/restart/backup-restore check passed again against
  those packaged resources. Synthetic screenshots remain ignored under
  `research-library/testing/reader-notebook-flow/`.

Limits: this is a local presentation refinement. It does not add file formats,
remove the existing 32 KiB import limit, change note/publication authorities, or
supply hosted sign-in/cloud sync. Formatting is conservative: unsupported or
normalized Markdown remains literal; original bytes and selectors are authoritative.
No automatic source rewriting, remote image loading or HTML execution is added.
Normal code review and owner usability review remain separate from these checks.

Review app: `~/Applications/Atlas Reader.app`, installed alongside the existing apps;
`codesign --verify --deep --strict` passed on that installed copy. It uses the
existing local owner state when the owner opens it; synthetic acceptance used a
separate temporary state directory. Quit the current Atlas instance before opening
this alternative build. No active app was replaced or relaunched during verification.
