# Personal Atlas note sync

Atlas keeps its existing research, reading and local notes workspace. Shared
notes are a separate, opt-in Go SQLite replica and loopback bridge. No launch,
account discovery, owner database scan, import or upload happens on application
startup. Empty personal workspaces remain usable without federation.

The reviewed generic implementation was ported from FA-TH-UR commit `50f2c21`.
Its Go module is `github.com/justin-napolitano/atlas`; local product, credential,
cookie and CSRF names use Atlas. The canonical `v1alpha1` contract and synthetic
cases remain byte-for-byte pinned to MU-TH-UR commit
`048ef1cbe34b8fe91c7d3da690145b87bd7a375b` by
`testdata/federation/provenance.json`. That repository name is provenance, not
organization runtime configuration. No organization endpoints, owner data,
credentials, SSO integration or deployment configuration were ported.

## Explicit configuration

Build with Go 1.26.5 or later and a C compiler (`go-sqlite3` uses native SQLite):

```sh
go build -o /private/tmp/atlas-federation-workspace ./tools/federation-workspace
go build -o /private/tmp/atlas-federation-replica ./tools/federation-replica
go build -o /private/tmp/atlas-federation-replica-probe ./tools/federation-replica-probe
```

Supply a private mode-0600 configuration outside the repository and browser
assets. Each replica requires an explicit absolute new path inside a mode-0700,
non-symlink directory. The service origin and verified user, organization and
stable device UUIDs permanently bind that file. Reopening under another identity
fails before writable initialization. Existing unrelated databases are rejected.
The launcher refuses non-loopback listening addresses and runtime files beneath
the static assets directory. Credentials are explicitly injected by the trusted
launcher in `ATLAS_CREDENTIAL_…` environment variables. There is no login or SSO
implementation and no fallback to browser or owner credentials.

Example configuration shape (all identifiers below are synthetic):

```json
{
  "listen": "127.0.0.1:0",
  "assets_dir": "/absolute/path/to/atlas/web/dist",
  "launch_file": "/absolute/private/runtime/new-launch.json",
  "private_workspace_url": "http://127.0.0.1:8000/workspace.html",
  "accounts": [{
    "id": "synthetic-alice",
    "name": "Synthetic Alice",
    "db_path": "/absolute/private/runtime/alice.sqlite",
    "organization_id": "10000000-0000-4000-8000-000000000001",
    "user_id": "10000000-0000-4000-8000-000000000002",
    "device_id": "10000000-0000-4000-8000-000000000003",
    "origin": "https://selected-service.invalid",
    "token_env": "ATLAS_CREDENTIAL_ALICE",
    "create": true,
    "upgrade_snapshot": "",
    "chat_enabled": false,
    "gold_enabled": false,
    "sources_enabled": false,
    "research_enabled": false
  }]
}
```

Run `/private/tmp/atlas-federation-workspace -config /absolute/private/config.json`.
Use `create: false` to reopen the same replica on later launches. The launch file
is created exclusively, mode 0600; use a fresh launch file path each time. Read
its local URL and one-time setup code privately. The code never appears in the
URL or stdout. The loopback session is HttpOnly, SameSite Strict, expires after
30 minutes and requires `X-Atlas-CSRF` on mutations. Host, origin and cross-site
checks also apply. Accounts and permitted brains are loaded only by explicit
selection. Sync starts with **Sync now**; **Sync while connected** is a separate
explicit choice for the selected brain. Disabling a brain stops future transfers.

Chat, Gold and source projection routes default off. Source records stay separate
from notes. The optional trusted `BridgeConfig.ResearchHandler` also defaults
absent, requires `research_enabled` and an enabled selected brain, and receives
the configured account and validated brain. `HTTPTransport.ResearchHTTPClient`
supplies a scope-bound server-side credential adapter accepting only the fixed
GET research state and POST research operations paths. Its 512 KiB request and
4 MiB response bounds do not relax note/chat limits. The typed research client
must retain its own validation, actor visibility, separate explicit SQLite file
and authoritative upstream checks. The UI `renderResearch` hook does not start
requests on its own.

## Local writing, conflicts and migration boundary

Native editing retains untouched Unicode, CRLF/mixed newlines and local drafts;
IME pauses autosave, and keyboard save does not replace the native undo history.
Saving a local edit atomically persists the working content and immutable retry
intent. Lost receipts and restarts resend the same operation ID and exact bytes.
A stale base shows retained base/local/server versions and requires a reviewed
new operation. Revocation suspends queued operations while retaining writing.
A server generation change archives old intent, retains the three-way writing,
and requires explicit resolution into a fresh operation. It never rebinds an old
operation to the new generation automatically.

`federation-replica preview` is metadata-only: it returns the selected replica's
identity and brain/page/operation/conflict counts, performs no network requests,
and does not create an owner-to-shared mapping. Supply explicit `-db`, `-origin`,
`-organization`, `-user` and `-device` flags. Mapping or importing the personal
workspace into a shared brain is intentionally unsupported. Preview is not an
upload confirmation, and ordinary note selection cannot migrate owner data.
Any future mapping workflow needs an explicit selected source, stable-ID mapping,
reviewed preview and separate confirmation before writing; it must not infer a
mapping from local paths or silently merge notes.

`snapshot` creates a new private native SQLite copy, verifies integrity and
identity, disables sync in the copy and checkpoints the WAL. `restore` also
creates a verified new copy; it never overwrites the original. Use a fresh
absolute `-destination` and explicitly select a brain again after rollback.
Upgrading a legacy replica requires an explicit new `upgrade_snapshot` before
schema migration. The existing personal SQLite/PostgreSQL path is unchanged.

## Synthetic validation

```sh
go test -race ./internal/federation/... ./tools/federation-...
go vet ./internal/federation/... ./tools/federation-...
go run ./tools/federation-conformance -sha256 2c049db2a40b1db9047588c327e711c23e49d1f571386723d75ab7940d129101
node --test web/src/federation/*.test.js
```

The Go suite uses actual disposable native SQLite files and loopback HTTP,
including two independent replicas, exact retry after a lost receipt and restart,
concurrent conflict/merge, tombstones and revoked pending writes. Separate tests
cover generation restoration, rollback, cursor checkpoints, strict response
validation, account isolation and local session/CSRF/feature boundaries.

For the independent MU PostgreSQL fixture, run the executable
`federation-replica-probe` with explicit `ATLAS_REPLICA_PROBE_` variables:
`URL`, `ORGANIZATION_ID`, `BRAIN_ID`, `ALICE_USER_ID`, `BOB_USER_ID`, `PAGE_ID`,
`TOKEN_ALICE`, `TOKEN_BOB`, `CONTENT_MARKER`. URL must be literal loopback HTTP;
the fixture must provide disposable synthetic identities and an empty target
page. The probe creates two private temporary SQLite files, restarts each,
checks exact Unicode, conflict resolution and tombstones, then prints
`READY_FOR_REVOCATION`. Revoke Bob in the fixture and write `REVOKED` plus newline
to stdin. The probe verifies denied transfers stop and pending writing survives.
It never reads app credentials or an owner workspace. `federation-http-probe`
offers the smaller canonical HTTP replay/denial check with `ATLAS_HTTP_PROBE_`
variables as documented in its source. Neither probe is native desktop or SSO
acceptance; a successful build alone does not establish those checks.
