# Private vault first delivery

2026-10-21. Local desktop implementation, stacked PRs #249–252. The local app was
updated with the editor fix in PR #253 after a normal quit, pre-update database
backup and retention of the previous bundle. The actual private vault has not
been connected or populated with owner notes.

## Available behavior

- Connect the existing native GitHub CLI login to one verified private personal
  repository and branch. Account/repository IDs are pinned. Connection uploads nothing.
- Select up to ten saved standalone pages, review exact revisions, then apply.
  Optional bounded remote discovery imports new portable pages. Markdown bytes,
  stable IDs and supported links round-trip; divergent versions are retained.
- Durable dispatch intent is committed before network calls. GitHub commits use
  atomic expected-head comparison. Lost acknowledgements reconcile exact content;
  newer local typing stays queued. No force push or deletion propagation.
- Tasks saves independent work locally, without requiring a connection. `/task Title`
  in ordinary page text offers the same capture with exact saved context. Arrows,
  Enter/Tab and Escape operate the completion. Cmd+Z restores the removed command.
- Sync tasks explicitly creates pending issues or reconciles uncertain creation.
  A lost POST response never authorizes another POST. Context links require the
  captured page snapshot to have a confirmed vault commit; otherwise work stays local.
- Refresh reads remote issues into searchable cache; completion/reopen changes
  only the issue state. GitHub title/body edits survive. Comments load explicitly.
  Issues and comments never grant authority to execute their contents.

## Limits and next delivery

This is manual, bounded synchronization: ten pages/operations per reviewed batch,
up to 500 issues per refresh, up to 100 comments per selected issue refresh. The UI
reports those coverage limits. Connection and unsent work survive database restart.
Task titles/descriptions are captured locally; subsequent remote content editing is
currently through GitHub, with refresh back into Atlas. State changes use local CAS
and state-only remote PATCH, not a claimed atomic GitHub issue-body CAS.

Portable page v1 excludes source-bound notes, original files, reader positions,
legacy project context and unsupported links. Those remain local, visibly excluded.
Hierarchy/folders and complete Obsidian vault compatibility are not claimed. First
owner sync stays an explicit reviewed selection. Hosted app sync, automatic polling,
background agent execution and bundled OAuth remain deferred. Installed/authenticated
GitHub CLI is required; Atlas does not store or expose its credentials.

Issue/comment **portable API export and fresh-cache restore** remain #247. A Git
clone does not back up issues. Existing coordinated PostgreSQL/local-file backups
cover local task tables and cached comments; this is distinct from portable exports.
The epic stays open until these gates and the owner's review are complete.

## Verification and review evidence

- 421 Python tests pass, one expected skip, against disposable PostgreSQL; 180
  frontend tests pass; production frontend builds. The additional task API boundary
  checks pass after that full-suite run.
- Synthetic native Electron journey passes keyboard connection, selection/review/apply,
  task capture, explicit sync, `/task`, context return, reload and 390px overflow checks.
- Dedicated private GitHub fixture passes real expected-head commit/replay, external
  Markdown edit/pull, issue creation/replay, state-only update and comment retrieval.
  It contains synthetic data only; the actual owner database/vault were untouched.
- Copied frozen runtime passes native keyboard properties, offline task capture and
  exact replay, restart, coordinated database/file backup and restore, original
  artifact verification, and rejection of corrupt/tampered restores. Nine Electron
  backend/policy tests pass outside the localhost-restricting sandbox.
- Final local app packaging and deep/strict ad-hoc signature verification pass.
  Review artifact: `research-library/desktop-build/Atlas-darwin-x64/Atlas.app`.
  It bundles the runtime/database and contains no owner data. It is a local
  development build, not notarized distribution. The installed owner app is not
  replaced or restarted by packaging itself; the later PR #253 installation is
  recorded above.

Security review covers private binding/visibility changes, fixed-host native CLI
arguments, sanitized credential environment/output, owner/session/origin/CSRF checks,
explicit table grants, no public routes, safe Markdown rendering, bounded batches,
unknown outcomes, source exclusions and untrusted issue text. The new PyYAML 6.0.3
parser is pinned and bounded, with no alias/custom-object construction; malformed
properties remain raw writing. This is implementation evidence, not external AppSec
approval or a production credential-provider certification. Release review of the
native authentication/private-data integration remains flagged.
