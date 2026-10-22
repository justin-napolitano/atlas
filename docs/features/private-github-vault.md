# Private GitHub vault and task workspace

Owner-approved direction, 2026-10-21. Contracts below define the target. The local
first delivery is implemented in stacked PRs #249–252; see the [delivery record](private-github-vault-delivery.md)
for verified behavior and remaining gates. No owner-data migration or automatic
background sync has been enabled.

## Outcome and scope

One private content repository holds the owner's portable Markdown context; its
GitHub Issues hold actionable work. Atlas remains an offline-first reader, writing
surface and searchable graph over that material. Life administration, loose ideas,
research and agent assignments share identities without requiring projects.

Application source remains in its existing open-source repository. Vault location,
credentials and private material must never enter public code, examples, issues,
frontend assets, telemetry or publication snapshots. Technical feature planning may
remain in the application tracker; personal tasks belong only to the private vault.

This explicitly advances **GitHub vault sync for the local Electron app** despite
the older blanket sync deferral in #220. Hosted GCP application sync, web authoring,
multi-user permissions and autonomous agents remain deferred. No direct remote SQL.

## Authorities

| Material | Authority after an explicitly reviewed first sync | Atlas responsibility |
| --- | --- | --- |
| Page body | Exact UTF-8 Markdown in Git | Durable offline edits, three-way sync, search/live editor |
| Page identity/name/type/links | Versioned page record, with valid known frontmatter projected by the existing classification contract | Preserve UUID, optional metadata and unknown YAML |
| Task title/body/open-or-closed state | GitHub Issue | Cached local view, queued CAS-aware changes, context links |
| Task comments | GitHub issue comments | Attributable discussion; edits retain remote identities |
| Issue snapshots | Derived API export | Offline search/backup; never an independently edited authority |
| Editions, quotes, locators and progress | Existing local records until a separately proven portable representation is delivered | Never remap anchors or claim reader-state migration |
| Agent output | Attributable proposed findings/run records | Owner acceptance stays separate from the proposal |

Existing PostgreSQL records remain authoritative until per-record cutover is proven.
The first connection does not change authority or upload anything automatically.
After cutover local writes are pending edits against the last acknowledged remote
base, not a second independently edited cloud copy. Local revision and Git object
identity are distinct values. Do not derive one from the other.

Frontmatter stays optional. Initially round-trip body bytes with a versioned
`.atlas/pages/<uuid>.json` record containing stable ID, safe relative Markdown path,
title/title mode, existing role, typed links and immutable source bindings where
supported. Do not inject wrapper YAML into existing bodies or strip owner fields.
Known frontmatter types and sidecar role cannot silently diverge: valid explicit
type edits are one logical page operation; conflicting inputs require resolution.

## Portable layout v1

- `notes/<uuid>.md` initially keeps exact body text and stable collision-free paths.
  Human display titles are not identity. Human-readable paths and physical folder
  moves can follow once mapping/rename acceptance is proved.
- `.atlas/pages/<uuid>.json` maps that file to the original page ID and metadata.
- `.atlas/issues/<repository-id>/<issue-node-id>.json` holds derived issue snapshots;
  comments have stable IDs, timestamps and authors. Git clone alone is not backup
  for GitHub API state. Snapshot writes never create new GitHub issues.
- `sources/` contains source identity/edition/locator records, not silently copied
  licensed books. Large originals stay in managed storage with digest pointers.
- `runs/` contains attributable execution receipts and result links, not arbitrary
  duplicated personal context or secrets. No execution engine ships in first slice.

External renames with an unchanged manifest path produce a visible missing/orphan
condition, not title-based reassociation. Unknown files/versions remain untouched.
Missing remote files, trashed local pages and unavailable references are distinct;
deletion propagation is deferred until its explicit tombstone contract is tested.

## First delivery, in dependency order

1. **Connect and preview.** Choose one private GitHub repository and branch, pin
   account ID + repository ID, verify private visibility and permission, show an
   initial inventory/diff without reading unnecessary content. Explicit owner action
   chooses which existing pages to upload. Review what is unsupported or excluded.
2. **Markdown round-trip.** Pull/push standalone pages with exact bytes, identities,
   classification, stable page links, draft/revision recovery and conflict safety.
   Report coverage; source-bound records are not portable until their dependencies
   can be imported without changing bindings. Do not claim all readings are synced.
3. **Tasks and `/task`.** One Tasks destination in the existing sidebar. Keyboard
   capture creates an issue linked to the current saved page, without replacing it.
   Support new independent tasks too. No forced assessments, stages or project form.
   The issue body can contain its own task description; references point to relevant
   files/page IDs rather than copying every linked page. Existing questions remain
   pages unless explicitly made actionable. Remote task edits and closure return to
   the same task in Atlas; an unsynced draft is clearly not yet a GitHub issue.
4. **Portability proof.** Issue/comment snapshots and a second fresh local instance
   reconstruct supported notes/tasks with exact IDs and links. Test interruptions,
   access loss, changed remote visibility, restores and independently edited copies.

An agent consuming tasks and executing them is a later, separately authorized
feature. A note or issue is context, never blanket authority to run commands.

## Keyboard interaction

- Cmd/Ctrl+N stays blank-page capture; existing `/type`, links and source reading work.
- `/task` opens a cursor-adjacent task capture action. Enter creates only after the
  user chooses the action; Escape leaves ordinary writing untouched. No automatic
  issue creation just because a body contains the text `/task`.
- Task capture keeps a stable local UUID through offline work, restarts and uncertain
  remote responses. Creating from a page waits for its exact save or retains a clear
  pending context binding. It never associates an issue with an older hidden draft.
- Tasks supports keyboard search, navigation and open/close. Open GitHub is optional.
  Task/page links open in the same Atlas surface and preserve unfinished writing.
- Show Local saved, Pending GitHub, Confirmed at <time>, Conflict, or Access lost
  independently. Do not relabel the entire workspace Synced after a partial batch.

## Sync and failure contract

- Persist the local edit and outbound intent atomically before attempting network.
  Freeze an operation's UUID/payload before dispatch. Never commit every keystroke
  directly to GitHub; coalesce safe pending edits and use bounded serial batches.
- Track the last acknowledged content hash, Git blob/ref identity, issue update
  identity, local revision and pending operation separately. Remote ref updates use
  non-forced expected-base updates. There is no force push or last-writer overwrite.
- Local-only change can push; remote-only change can pull using local CAS; matching
  changes converge; different changes on both sides preserve both and need explicit
  resolution. A later acknowledgement cannot replace newer local typing.
- GitHub issue creation is not treated as inherently idempotent. Record a stable
  operation marker plus a durable receipt; a lost acknowledgement enters uncertain
  state and is reconciled against remote records before any repeat POST. Uncertain
  or incomplete discovery never means 'absent, create another'. Filter pull requests
  out of issue listings and qualify numbers by stable repository/issue IDs.
- Use conditional/incremental fetches and bounded pagination. Report incomplete
  coverage; handle primary/secondary rate limits and Retry-After. Serial mutations
  and backoff must keep the local editor responsive. No fleet polling storm.
- A missing private resource may reflect lost authorization. A 404 never authorizes
  deletion, repo recreation, copying content elsewhere or publication.
- Recheck account/repository ID, private visibility and configured branch before
  uploads. Account or visibility changes pause writes. Connection changes do not
  silently replay pending work into a different repository.

## Security and implementation boundaries

Credentials belong in OS-protected storage/native authentication, outside renderer
state, Markdown, DB content exports and logs. Prototype use of the existing `gh`
login requires an explicit trusted native bridge with fixed command arguments,
GitHub host, bounded output and no shell or token output; it is not a portable
bundled auth implementation. Choose and document the production credential provider
in the connection issue. Prefer repo-scoped permission to Issues/Contents as needed.

Register new vault capabilities only in the trusted desktop service, keeping owner
session/origin/write protections and hosted/public route exclusions. API requests
cannot choose arbitrary hosts, executable paths, filesystem roots or repositories.
Validate file paths, size, encoding, UUIDs, source bindings, hashes and schema version.
Reject traversal/symlinks/unsupported structures without overwriting either copy.
Do not execute imported code, hooks, workflows, Markdown, issue instructions or HTML.

Threats to cover in implementation review: spoofed account/repo (high: pin identities),
tampered/stale remote state (high: hashes/CAS/three-way merge), credential or context
disclosure (high: native secrets, private-only gating, no content logs/public export),
unattributed agent changes (medium: actor/run/source receipts), API abuse/unbounded
sync (medium: limits/backoff), and task-driven privilege escalation (high: context is
untrusted and execution needs separate authorization). New authentication, external
integration and private-data paths require the policy's security/dependency review;
this planning document does not assert external approval.

## Acceptance before connecting owner data

Use disposable private test repositories and synthetic local databases. Never use
the owner's actual vault or notebook as a test fixture. Verify:

1. Correct private account/repo binding; public/wrong-account/changed-visibility and
   missing-permission writes rejected; hosted/public APIs cannot reach vault routes.
2. Exact Unicode/RTL/Markdown/frontmatter, stable IDs, titles, roles and links survive
   push, direct file edits, pull, rename/missing detection and fresh-instance import.
3. Offline capture, held responses, process restart, unknown GitHub creation outcome,
   duplicate delivery and rate limits preserve writing and create one intended issue.
4. Concurrent Markdown and issue changes preserve both versions; pending new typing
   remains reachable; unsupported anchors are explicit rather than fabricated.
5. `/task`, Tasks search and page→issue→page navigation work from the keyboard without
   a second shell, forced settings form or lost editor/reader position.
6. Issue/comment export is restore-tested separately from Git history. Restoring a
   local backup against newer remote data never blindly overwrites it.
7. First-sync preview matches the actual upload selection; excluded private items,
   credentials, licensed originals and unsupported state never appear in the remote.

## Primary references

- [GitHub Issues API](https://docs.github.com/en/rest/issues/issues)
- [GitHub API best practices](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api)
- [GitHub repository backup](https://docs.github.com/en/repositories/archiving-a-github-repository/backing-up-a-repository)
- [Fine-grained token permission reference](https://docs.github.com/en/rest/authentication/permissions-required-for-fine-grained-personal-access-tokens)

Use the existing GitHub Git/Issues protocols and Markdown/YAML/JSON representations.
Do not describe the versioned Atlas mapping as an existing universal sync standard.
