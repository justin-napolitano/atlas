# Portable desktop storage and synchronization

2026-10-20 owner direction: installing Atlas should provision application-owned
local storage and synchronize with the hosted research service. This is the next
desktop milestone, not a capability supplied by the initial Electron wrapper.

## Proposed storage contract

- Embedded SQLite belongs in the desktop user-data directory; installing an app
  must not require installing or administering PostgreSQL. SQLite is a proposed
  local engine, not a change to the hosted PostgreSQL authority.
- Save notes, annotations, source/edition identities, library membership and reading
  progress locally first. Atomically commit each edit and its outbound operation.
  Keep large downloaded texts/files in a managed content store, referenced by digest.
- A local save means durable on this device. Show pending sync, synchronized and
  conflict/error states separately. Never show cloud success for a local-only save.
- Sync authenticated, versioned application operations through the hosted API;
  never expose PostgreSQL credentials or connect desktop clients directly to SQL.
- Reuse global record IDs, edition/version identities and canonical passage locators.
  Repeated operations have stable idempotency keys. Pull incremental changes using
  a server-issued cursor, advancing it only after the local transaction commits.
- Use explicit revision preconditions. Preserve both divergent note versions and
  make resolution inspectable; no silent last-writer overwrite of Markdown bodies.
  Define progress, reading-place and deletion/tombstone merge rules independently.
- Bind the replica to the authenticated owner. Keep credentials in OS-protected
  storage in a privileged process. Imported text and renderer code never access DB
  files or sync credentials directly. Signing out must not silently erase drafts.
- Retain/download books per edition for offline access. Distinguish metadata-only
  shelf entries from retained content. Respect provider access and redistribution.
- Private synchronization never implicitly publishes research. Existing explicit
  review/publication and public read-only boundaries remain authoritative.

## Delivery order and release gates

1. Inventory existing API contracts and PostgreSQL-specific behavior. Specify the
   shared record/operation model, SQLite schema/migrations, revision and deletion
   rules. Evaluate existing sync engines before committing to a custom protocol.
2. Add local storage behind the existing workspace API contract and prove existing
   reader/editor/recovery tests against it. Include crash-safe migrations, consistent
   backup/restore and a reviewed, reversible import of current local PostgreSQL data.
3. Add authenticated server change feed and idempotent push/pull, preserving CAS,
   ownership and exact annotations. Do not weaken production IAP to test desktop auth.
4. Prove two devices: edit offline, terminate/restart, reconnect, retry a lost response,
   edit the same note concurrently, delete while offline, restore a backup, expire auth.
   Assert no lost bodies, duplicated records, moved annotations or accidental publication.
5. Package a self-contained signed/notarized app with retained UI/corpus, migrations,
   least-privilege native access and tested upgrades. No checkout or system Python
   dependency. Verify fresh-machine installation and offline cold launch explicitly.

Current Electron milestone uses this Mac's existing native PostgreSQL and installed
checkout/runtime. It does not ship SQLite, synchronize devices, or provide a portable
installer. It must continue working while the next milestone is developed; do not
silently migrate the live owner database.

Reference: SQLite documents embedded application storage and local caching of server
data as supported use cases: <https://www.sqlite.org/whentouse.html>.
Related: #218 (current desktop shell), #42 (cross-device release proof), #91
(ownership across devices), #94 (reading place), #216 (legacy migration).
