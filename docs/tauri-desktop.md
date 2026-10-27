# Tauri desktop migration

Owner decision: 2026-10-26. Replace the Electron shell with Tauri while preserving
the existing local PostgreSQL database, frozen Python service, source identities,
writing/recovery, backups, and editor. This supersedes the Electron shell selection
in the older desktop contracts; their storage and preservation rules still apply.

Implementation branch: `feat/tauri-desktop`. This is a local macOS migration, not a
new hosted service, storage migration, cloud sync feature, or notarized distribution.

## Startup and native behavior

`desktop/tauri/` contains the Rust host and its small bundled opening screen.
The visible native window is created before a background thread starts storage.
The service may still need to start PostgreSQL, check/apply migrations and perform
a due recovery backup. Those operations remain mandatory; the owner sees an opening
state while they run. The shell does not claim the workspace is ready prematurely.

The existing compiled React UI is served by the same frozen owner service over an
owned ephemeral loopback socket. The host validates the child's bounded port
announcement, reads the owner-private session file, checks readiness without proxies
or redirects, sets an HttpOnly/SameSite cookie natively, and opens the saved route.
No credential is put in an address, renderer global, native bridge, or log.

The native menu retains New Page, editing shortcuts, guarded Reload, zoom,
fullscreen, backup, restore and Show Backups. Closing the window checks the existing
`beforeunload` handlers before hiding it; Dock activation reopens it. Cmd+Q checks
the same handlers, closes the owned service pipe and waits for shutdown. A missing
or invalid guard reply is treated as potentially unsaved writing. Explicit discard
restores the Continue route. Restore uses the existing verified-copy/new-database
flow and keeps the original database; it runs after guarded shutdown and restarts.

The service owns PostgreSQL shutdown decisions. The shell never kills a shared
database or another browser workspace. App data remains under `~/.local/share/atlas`;
window preferences retain the Electron-era `Library/Application Support/Atlas`
location. Changing shells does not import, rewrite or duplicate owner research.

Native acceptance uncovered an existing shutdown race: an idle API has no active
SQL connection, so `pg_stat_activity` cannot establish service lifetime. The local
launchers now hold shared advisory file locks while starting/serving. Shutdown
requires an exclusive lock. A cluster already running before launch is retained
conservatively, including older browser/Electron consumers without leases. Native
tests exercise a second service exiting while the original API remains usable.

## Native boundary and threat review

The Rust host has no renderer-invocable application commands or granted Tauri
capabilities. Permission requests default to deny. Navigation allows only the owned
workspace/publication pages; external HTTP(S) citations open in the system browser.
Native/file/javascript popups are denied. Downloads require an owned origin (or an
owned blob) and a native save choice with a sanitized default name. The owner
service's strict CSP, CSRF/origin/session checks and role gates remain unchanged.
Unlike Electron's request interception, WebKit resource restrictions rely on that
server-supplied CSP; verify it in the assembled native app.

| STRIDE risk | Impact | Mitigation / evidence required |
| --- | --- | --- |
| Spoofed local service | High | Bound child announcement, native-only private cookie, exact origin, no proxy/redirect |
| Imported text obtains native privileges | High | No app commands/capabilities; strict CSP; navigation and permission denial |
| Private research leaks through package/logs | High | Allowlisted runtime resources, generic errors, suppressed child diagnostics |
| Shutdown or restore loses writing | High | Existing dirty handlers checked natively; fail closed; original retained on restore |
| Startup cancellation leaves orphan service | Medium | Owned stdin EOF, bounded wait, kill only owned child; cancellation test |
| App replacement changes database authority | High | Same external private state and frozen storage implementation; no new store |

New Rust dependencies and native session/process handling require human security
review before merge/public distribution. This document is the implementation threat
record, not an independent AppSec approval. Local development signing is ad hoc.

## Build

Install the Rust toolchain and existing offline-runtime build dependencies. Use the
runtime instructions in [desktop-standalone.md](desktop-standalone.md) to build
`research-library/desktop-resources` from the current source and pinned PostgreSQL.
No Rust, Python installation, npm or checkout is needed by the packaged application.

```sh
cargo test --locked --manifest-path desktop/tauri/Cargo.toml
cargo build --release --locked --manifest-path desktop/tauri/Cargo.toml
python3 scripts/package_tauri.py
```

The packager writes `research-library/tauri-build/Atlas.app`, refuses to overwrite an
existing output, copies only the offline resources and release binary, generates
the existing Atlas icon and verifies the ad-hoc signature. It does not install the
app, stop an existing workspace, or access owner data. Keep the previous Electron
bundle available until native acceptance passes. Rust dependencies are pinned and
their transitive checksums are committed in `Cargo.lock`.

## Verification

Native acceptance uses a separate binary compiled with `native-review`; the
installed release must never enable that feature. Packaging verifies `--build-info`
and rejects test builds; the offline checker likewise rejects production binaries
before launching any test. Production rejects `--review` before accessing state.
The harness only accepts a marked
private `/private/tmp/atlas-offline-*` test directory with fixed paths. It cannot be
enabled through an environment variable in a normal release build.

```sh
cargo build --locked --features native-review --manifest-path desktop/tauri/Cargo.toml
python scripts/check_desktop_offline.py --tauri desktop/tauri/target/debug/atlas-desktop
```

This exercises the actual WebKit window against an isolated synthetic PostgreSQL
database and copied frozen resources, alongside the existing offline backup,
restore, identity and conflict checks. The native receipt records opening-window
and workspace-ready timings separately. Do not equate smaller bundle size with a
measured end-to-end startup improvement or claim owner usability acceptance from
synthetic tests. Current validation evidence is recorded below as checks complete.

### Verified on the build Mac

- Five Rust boundary/process tests pass: malformed service announcements, foreign
  URLs, credential-file gates, authenticated readiness/EOF, and cancelled startup.
- Seventeen Python storage/owner-runtime tests pass, including idle service leases
  and conservative retention of a pre-existing database. The test extra now pins
  the `httpx2` dependency required by the already-locked Starlette test client.
- Actual WebKit runs pass twice against copied frozen resources and one isolated
  PostgreSQL database. They verify Unicode Markdown save/reload, body-first New Page
  via the native action, dirty close protection, exact file exports, full Qur'an
  reading, credential isolation, CSP enforcement, unsafe-popup denial and process
  restart. The original API remains usable after the native service exits.
- The surrounding offline check passes fresh initialization, located Qur'an notes,
  source/file retention, library/progress, note types and task context, revision
  conflicts, backup/restore with original artifacts, and corrupt/tampered restore
  rejection. No owner database was used.
- Debug opening-window timings were 315 and 336 ms; workspace-ready timings were
  6.53 and 20.27 seconds while other builds were running. These separate measurements
  demonstrate early visible feedback, not an end-to-end speed comparison to Electron.
- Rustfmt and Clippy with warnings denied pass. RustSec audit of the lockfile reports
  zero vulnerabilities and three informational warnings (`proc-macro-error`,
  `zbus_names`, `glib`). None appears in the resolved x64 macOS dependency tree;
  their other-platform warnings remain visible rather than suppressed.

The production app is installed at `~/Applications/Atlas.app`; its authenticated
local service reports ready. The optimized shell is 4.5 MiB and the signed app
bundle is 175 MiB, versus 464 MiB for the previous Electron bundle. The embedded
window icon is 256 px; full-size Dock artwork remains separate. All 875 offline
runtime files match the signed-bundle resources that passed the copied-runtime
check. Deep/strict ad-hoc signature verification passes. A backup created with the
previous runtime and the previous Electron app are retained locally. Returning to
an older schema may require recovery from the matching pre-upgrade snapshot;
retaining an executable does not authorize forcing a schema downgrade.

All PR checks passed, including native policy, dependencies, browser, containers,
storage boundaries, graph validation, and PostgreSQL 17/18 contracts.

Native menu-dialog choices, physical keyboard routing,
and owner usability remain manual acceptance items; the synthetic build substitutes
fixture destinations and the conservative Keep Writing choice for native dialogs.

## SQLite follow-up

For the local single-owner app, SQLite is the next storage candidate to evaluate.
It embeds in the service and removes database-server startup and packaging;
MySQL would retain a separate server. The current resource breakdown is about
116 MiB PostgreSQL, 53 MiB frozen Python and 1.4 MiB UI. These are local build
measurements, not promised savings from an unimplemented port.

The existing PostgreSQL JSONB/search/triggers/roles, revision conflicts, stable IDs,
backup-plus-artifact restore and source bindings must be mapped and verified before
any storage switch. Keep PostgreSQL authoritative until that migration is reviewed;
this Tauri change does not create a second database authority. See SQLite's
[application-storage guidance](https://www.sqlite.org/whentouse.html) and
[embedded/serverless architecture](https://www.sqlite.org/serverless.html).
