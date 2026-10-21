# Self-contained offline Mac build

Owner request, 2026-10-20: complete local installation without cloud synchronization.
The initial configured-checkout Electron shell is superseded by this packaging target.

## Implementation decision

Bundle a frozen Python owner service, compiled owner UI/pinned corpus and the native
PostgreSQL engine. The existing stores/migrations rely on PostgreSQL JSONB, triggers,
full-text search, role grants and transactional revision behavior. Preserve those
features rather than introducing an incomplete second storage implementation. SQLite
remains a possible later storage port; it is not part of this build or an existing feature.

Installable application resources contain engine/runtime/public corpus only. Never
bundle a user's database, session credentials, private reading or backups. A fresh
launch creates a private database automatically; an existing recognized local Atlas
database remains in use with stable identities. No Python, Node, npm, git checkout,
Docker, separately installed Postgres.app or internet should be required at runtime.
This pass targets the architecture of the build Mac, not a universal binary.

## Preservation and lifecycle contracts

- App data lives outside the replaceable app bundle, under the existing private
  `~/.local/share/atlas` directory. Replacing Atlas.app never replaces this data.
- Bind the owner HTTP service only to an owned ephemeral loopback socket. PostgreSQL
  has no TCP listener; use owner-private Unix sockets and least-privilege runtime role.
- Start/migrate only a recognized cluster of the bundled PostgreSQL major version.
  Back up before pending schema changes. Unknown clusters, downgrade attempts,
  symlinked/private-state violations and failed migrations must stop without erasure.
- A recognized earlier local cluster can remain shared with browser service 5187.
  Never stop that shared cluster or close the owner's running reader while packaging.
- If this desktop process starts a private database and no other process uses it,
  shut it down after the API closes. A pre-existing shared database remains running.
- Provide native backup/restore commands with private consistent custom archives.
  Verify restored data in a newly created database before selecting it; preserve the
  original. No SQL dump from untrusted strangers is an import format.
- Auto-save notes/revisions/recovery, source editions, locators, library and reading
  place/progress using the existing owner API. No renderer-local substitute database.
- No cloud configuration, sign-in, sync queue, background remote upload or publication
  is added. External discovery remains user-initiated and may be unavailable offline.

## Required acceptance evidence

Run the frozen runtime from a copied package in a path with spaces, an isolated clean
state directory, stripped environment and without using checkout resources. Create a
fresh cluster and all migrations; exercise real API/renderer editing, annotation,
Qur’an reading, library retention, progress/place, restart, revision conflict and
backup/restore. Verify ordinary launch does not fetch dependencies. Check process
ownership on quit and private file permissions. Prove repeat launch preserves data.
Tests may create synthetic isolated databases only, never alter owner writing.

Native package signing is local ad-hoc development signing. Developer ID notarization
requires the owner's signing account and remains a distribution gate, not a reason
to claim an unsigned build is a public release. Security-sensitive runtime and new
build dependencies stay in a reviewable PR.

Threat boundaries: untrusted text remains in the isolated sandboxed renderer; only
the trusted main/service can reach private state. Startup and restore are privileged
operations and must reject foreign paths/artifacts. Store no credentials in packaged
files or renderer globals. Existing CSRF/CSP/role/publication restrictions remain.

## Using the local app

Open `~/Applications/Atlas.app`. Reading, notes, source versions, highlights, revisions,
library and reading progress use the existing owner database. The installed app now
contains its own Python/API runtime and PostgreSQL 17.11 tools; it does not launch a
Python interpreter from the checkout. Discovery and books not yet retained still
require internet. The pinned complete Qur’an and retained reading snapshots do not.

The native **File → Back Up Research Now** command creates a consistent snapshot in
the private `~/.local/share/atlas/backups` directory and can open that folder. Atlas
also makes a daily snapshot at startup and backs up before pending schema changes.
These contain saved database state; unfinished editor changes must finish saving first.

**File → Restore Local Backup…** accepts a snapshot and checksum receipt created in
this installation's private backups directory. It checks bytes/digest, restores into
a new database, compares all private table counts, reapplies and audits least-privilege
grants, validates migrations, then changes the selected database atomically. It retains
the original database and makes a pre-restore backup. Corrupt or foreign archives do
not become selected. Restore restarts Atlas through its normal unsaved-writing guard.
Other separately launched browser API processes keep their previous database until
restarted; restore does not silently repoint those processes.

Replacing the application bundle leaves the data directory intact. A rollback copy
of the initial configured shell is retained under the ignored local build directory.
No migration from older JSON preview notes is implied; that is still #216.

## Build and verification

Build tools live in their own environment; do not synchronize dependencies into a
shared `.venv` belonging to another worktree:

```sh
env UV_PROJECT_ENVIRONMENT=research-library/desktop-build-env uv sync --frozen --extra api --extra database --group desktop-build --python 3.12
research-library/desktop-build-env/bin/python scripts/build_desktop_runtime.py --postgres /path/to/verified/Postgres.app/Contents/Versions/17
cd desktop
npm ci
node node_modules/electron/install.js
npm run package
```

The native engine source is official [Postgres.app 2.9.6, PostgreSQL 17.11](https://github.com/PostgresApp/PostgresApp/releases/tag/v2.9.6).
The verified `Postgres-2.9.6-17.dmg` SHA-256 is
`b38bb00b8c8702a568270aab85995c550f7f93d1503b818efdc5ff9a519b7168`.
The builder copies only core tools, required built-in modules and the actual dynamic
library dependency closure. Relative library links must remain inside the copied
package; packaging fails if deep/strict signature verification fails.

Evidence from the configured Mac:

- Nine Node policy/process tests pass, including direct frozen-service launch without
  a Python/checkout environment. Four restore/filesystem gate tests and ten local
  authentication/owner-frontend tests pass. Dependency audit reports zero findings.
- `scripts/check_desktop_offline.py --electron` passes from a copied resources folder
  with spaces, clean state and stripped environment. Actual native sandboxed Electron,
  fresh PostgreSQL and real HTTP APIs verify Markdown, located Qur’an notes, library,
  progress/place, dirty-close protection, reload/reopen, restart, CAS rejection,
  consistent snapshots, verified restore and rejection of archive tampering.
- The same offline storage/restart/restore test passes again against resources copied
  from the final signed `.app`. No test writes to owner research.
- The final and installed Mac bundles pass `codesign --verify --deep --strict`.
  The installed app's bundled service reports ready against the existing local data.
- Node and Python boundary checks run in CI. Native Mac packaging and the full frozen
  PostgreSQL/Electron checks above are local evidence, not cross-platform CI claims.

No cloud services, uploads, hosted owner sign-in, synchronization, public release,
notarization or automatic updates were configured in this pass. Current artifact is
the build Mac's x64 application; other architectures/fresh OS versions need their own
build and installation verification. [PyInstaller's packaging model](https://pyinstaller.org/en/stable/operating-mode.html)
documents the bundled interpreter and platform-specific distribution boundary.

## Security review record

Security-sensitive process, session, storage, restoration and build-dependency changes
require human review in PR #219 before merge/public distribution. This table records
design risks and mitigations, not an independent security-audit result.

| STRIDE concern | Inherent impact | Boundary and mitigation |
| --- | --- | --- |
| Spoofed owner/service | High | Owned socket/child announcement; private session cookie; exact loopback host/origin |
| Tampered import or upgrade | High | Own verified snapshots only; new-database restore; migration checksums/major gates; original retained |
| Unattributable changes | Medium | Existing actors, revisions and compare-and-swap behavior preserved |
| Private data disclosure | High | Private external data directory; no research/credentials packaged or logged; sandbox renderer with no Node/IPC |
| Corrupt state or interrupted exit | High | Atomic DB writes, recovery, daily snapshots, guarded close, no in-place restore |
| Renderer/native privilege escalation | High | Isolation/sandbox/permission denial; bounded navigation/downloads; no arbitrary shell or SQL bridge |
