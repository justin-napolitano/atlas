# Persistent local research workspace

This runs the actual PostgreSQL owner store and compiled workspace on this Mac.
It replaces the disposable in-memory design preview for real reading/writing.
It is not a hosted service, Google sign-in, or cross-device synchronization.

## What persists

New Markdown notes and revisions, recoverable drafts, exact annotations, saved source
passages and hashes, source metadata, library membership/edition choices, collections,
questions/connections, reading places and explicit progress use the existing PostgreSQL
API. A reload or API restart does not erase them. The browser retains presentation
preferences and an HttpOnly local session, not a second private note authority.

The full pinned Qur’an corpus is a versioned package resource, not browser storage.
Retained source passages are database snapshots. Gutenberg uses its existing versioned
database cache; catalog availability is not permission to copy arbitrary full texts.

The earlier local review app saved JSON on this Mac; it was never PostgreSQL or cloud
sync. The progress import copies only the selected legacy Qur’an read/unread states
and last place into unused native owner reading state. Its complete input is backed
up privately first. Original dates and note bodies remain in that backup and the
original app; database import timestamps are not claimed as original reading times.
Old notes, highlights, writing histories/drafts, library/source bindings and other
preview-only state are **not migrated by this progress-only importer**. Do not delete
or replace the original preview or suggest those old notes already appear here.

## Local operation

Use a verified native PostgreSQL 17 installation. This Mac uses the official
[Postgres.app 2.9.6 release](https://github.com/PostgresApp/PostgresApp/releases/tag/v2.9.6),
the `Postgres-2.9.6-17.dmg` asset, SHA-256
`b38bb00b8c8702a568270aab85995c550f7f93d1503b818efdc5ff9a519b7168`,
with its application signature checked. No Docker/Colima or system startup service
is required. Database files live under `~/.local/share/atlas/postgres-data`, outside
the checkout, with owner-private directory permissions. PostgreSQL exposes a private
Unix socket only, no TCP listener. Its bounded profile uses 32 MB shared buffers and
16 maximum connections. This is a local development profile, not cloud sizing advice.

```sh
PYTHONPATH=src .venv/bin/python scripts/local_workspace.py init \
  --postgres-bin "$HOME/Applications/AtlasPostgres.app/Contents/Versions/17/bin"
PYTHONPATH=src .venv/bin/python scripts/local_workspace.py build
PYTHONPATH=src .venv/bin/python scripts/local_workspace.py serve --port 5187
# In a second terminal, establish the browser's private local session:
PYTHONPATH=src .venv/bin/python scripts/local_workspace.py open --port 5187
# Create a consistent, private local database backup:
PYTHONPATH=src .venv/bin/python scripts/local_workspace.py backup
```

The browser opens `http://127.0.0.1:5187/`. Use the launcher again when its local
session expires. Use exactly `127.0.0.1`, not another hostname or a LAN address.
Initialization applies checksummed migrations separately from runtime, creates
restricted `atlas_owner`/`atlas_public` logins, and runs the existing grant audit.
Passwords and session/launch credentials are generated into mode-0600 files in a
mode-0700 directory; none enter the frontend, command-line arguments or repository.
The runtime never connects as the schema owner. Reinitialization refuses an unknown
existing cluster rather than deleting it. Serving starts a stopped recognized cluster;
it does not run schema migrations on each request or erase data on exit/rebuild.

`import-progress --source PATH --project ORIGINAL_ID` is an explicit operator command,
not automatic startup. It refuses owner progress/places already in use. Resolve later
competing data explicitly. The complete private snapshot and progress import receipt
stay outside Git. This command is not a general legacy-notebook migration.

## Local session boundary

`local_owner.LocalOwner` is a separate development adapter; production owner/public
factories retain signed IAP verification and their HTTPS configuration requirements.
There is no production environment flag to turn authentication off. The local adapter
requires loopback peer, exact host and same-site requests. A generated launch credential
is passed as a browser fragment, cleared before an exact-origin JSON exchange, and
never reflected in an HTTP response or access log. The resulting owner session is
HttpOnly/SameSite=Strict; write requests additionally require exact local Origin and
the explicit research write header. Sign-in attempts are bounded. Browser-provided
identity headers are discarded. Only a validated local session reaches the original
API's owner, validation, revision and rate-limit boundaries.

| Local threat | Boundary |
| --- | --- |
| LAN exposure / DNS rebinding | Bind 127.0.0.1; reject non-loopback peers and any other Host |
| Forged identity / cross-site writes | Private session, ignored incoming identity headers, exact Origin/write header |
| Token/private text disclosure | No access logs, fragment cleared, no-store responses, no reflected inputs or browser note store |
| Runtime schema/history writes | Separate audited SQL role; schema-owner credentials stay in the operator process |
| Data loss / mistaken migration | Existing CAS/recovery, durable database, complete original backup, no automatic full-note import |
| Local mode accidentally deployed | Separate explicit launcher; unchanged production auth tests; no public network binding |

Local HTTP relies on the same OS account and loopback boundary. It is not production
TLS/IAP, protection from malicious software running as that OS account, hosted backup,
or an AppSec approval. Auth/session/data-access changes remain a reviewable PR; the
production release gates in #42 and owner reading acceptance in #146 remain open.

## Verification

```sh
PYTHONPATH=src .venv/bin/python -m unittest discover -s tests -p test_local_owner.py
PYTHONPATH=src .venv/bin/python -m unittest discover -s tests -p test_owner_runtime.py
PYTHONPATH=src .venv/bin/python scripts/check_local_workspace.py
```

Six local-session tests cover anonymous/header forgery denial, host/peer/CSRF checks,
secret boundaries, session continuity and unchanged production authentication. Four
production owner-runtime regressions pass. The real HTTP/SQL smoke check creates its
own disposable database, applies migrations/grants, then exercises independent Unicode
writing/frozen retries, exact Qur’an notes, explicit edition selection and library
retention, progress/position, an API restart and a competing-revision conflict. It never
adds synthetic notes to the owner database or prints owner note bodies. These are
actual local PostgreSQL results, not fixture-backed browser evidence or hosted proof.
