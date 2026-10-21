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
