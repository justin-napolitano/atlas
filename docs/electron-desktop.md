# Electron desktop milestone

Owner selected Electron, 2026-10-20. Reuse the existing reader, Markdown editor,
owner APIs, recovery and PostgreSQL authorities. This milestone is a local Mac
application for the configured machine. A self-contained signed installer, automatic
updates, full legacy-note migration (#216), hosted release (#42) and cross-device
offline synchronization are separate work. No silent data or storage-engine migration.

## Interaction contract

- Opening Atlas starts its own loopback owner API and the recognized local database
  when necessary. No terminal or website/login form is part of ordinary opening.
- The same library, full Qur’an reader, located notes, independent writing, progress
  and edition identities appear. Desktop is not a second workspace or fixture app.
- Bundle/use local compiled UI and pinned corpus resources. Previously retained book
  versions and writing remain usable without internet. Discovery, missing downloads
  and uncached word glosses retain explicit unavailable states.
- Restore the last valid workspace route and useful window dimensions. Store only
  these presentation preferences outside PostgreSQL, never another note body store.
- Normal save/recovery behavior stays intact. Prevent silent closure with unfinished
  writing; any discard choice must be explicit. Quit stops only the API child the app
  owns, never the shared PostgreSQL cluster or an existing browser reading service.
- One desktop instance. Reopening focuses the existing window. Native editing/zoom
  shortcuts work; external citations open in the system browser deliberately.

## Runtime and security contract

Use a current, exactly locked Electron release and the official packager. The first
local package may reference this checkout, its installed Python environment and the
existing native PostgreSQL installation; disclose those dependencies honestly.
Do not claim that copying it to another Mac is a supported standalone installation.

Electron main starts the trusted Python launcher with a private stdin pipe. Python
binds an ephemeral loopback socket before announcing its port; no fixed-port service
or browser-provided backend address is trusted. Parent exit closes the private pipe
and ends only its API child. Startup failure is visible and leaves data untouched.

Main alone reads owner-private session credentials and installs an HttpOnly cookie.
No credential enters a renderer, URL, preload bridge, console or packaged file.
Renderer Node integration is disabled, context isolation/sandbox/web security stay
enabled, no general IPC or filesystem bridge is exposed, and permissions default-deny.
Enforce the owned origin for renderer requests/navigation. Validate external HTTP(S)
citations before opening them outside Electron; deny file/javascript/custom schemes,
webviews, arbitrary popups and remote renderer code. Downloads require a native save
choice and a safe filename. Retain the backend's CSP, CSRF, role and private/public
boundaries; production IAP is unchanged.

| Threat | Required mitigation |
| --- | --- |
| Imported text gains native privileges | Sandboxed isolated renderer; no Node/preload/IPC bridge |
| Foreign service receives credentials | Owned bound socket announced over child pipe; no arbitrary backend URL |
| Citation redirects into privileged UI | Exact owned-origin navigation; validated system-browser opening |
| Backend survives app crash | Private parent-pipe lifecycle; terminate only the owned child |
| Quit discards pending writing | Existing beforeunload/recovery; explicit stay/discard choice |
| Packaged app contains private research | Package a small allowlist; no DB, credentials, library, checkout or owner data |

References: [Electron security](https://www.electronjs.org/docs/latest/tutorial/security),
[sandboxing](https://www.electronjs.org/docs/latest/tutorial/sandbox),
[application lifecycle](https://www.electronjs.org/docs/latest/api/app),
[official packager](https://electron.github.io/packager/main/interfaces/Options.html).

## Acceptance and evidence

Before handoff, verify native launch and restart, body-first Markdown editing and
reload through real APIs, Qur’an/book opening, renderer isolation, external-request
denial, and protected dirty closure. Exercise actual PostgreSQL through an isolated
synthetic database, not the live owner database. Unit tests must cover foreign origins,
unsafe schemes/paths, malformed child announcements, startup/exit handling and private
file checks. No sandbox-disable test flags or auth bypasses. Record the exact checks
that pass and any unverified packaging/release/sync limitations below.

Implementation and verification are pending in this initial contract commit.
