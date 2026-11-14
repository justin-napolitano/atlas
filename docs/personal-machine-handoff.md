# Personal Atlas: resume on another computer

Updated 2026-11-08 UTC. This is the starting document for a new person, machine
or agent session. GitHub is the execution tracker by the owner's instruction.
No old chat, local worktree, temporary binary or private helper is required.

## Start here

1. Open [parent issue #4](https://github.com/justin-napolitano/atlas/issues/4)
   and read its newest handoff comment, then this document and repo `AGENTS.md`
   and `SECURITY.md`.
2. Inspect current PR/issue state before acting; the snapshot below may age.
3. Check out the integration branch, not personal main alone. Main did not yet
   contain this implementation when this handoff was written.
4. Reproduce synthetic checks, choose an unclaimed follow-up issue, and record a
   fresh file reservation before edits. All previous worker reservations ended.

## Product and boundaries

- Personal product/repo: **Atlas**, `justin-napolitano/atlas`. Keep research
  groups, the general/Gutenberg e-reader, source context and existing owner data.
  FA-TH-UR's corporate notes-only interface is a different edition.
- Shared backend: **MU-TH-UR**, `digital-group-vaults/MU-TH-UR`. Brains are access
  boundaries; collections/group labels/frontmatter never grant access. Private
  and team brains can have explicitly granted members from several teams.
- Notes stay Markdown/frontmatter with stable IDs and revision history. Keep
  quiet direct interactions; do not expand feature menus or restore removed
  built-in scripture content. Obsidian is optional and low priority.
- Database-backed authority and maintained permission-filtered lexical search /
  PostgreSQL metadata are the direction. No embedding/vector-search system or
  GitHub-dependent runtime. GitHub export/review is an explicit separate flow.
- New backend/transport/storage work uses Go/SQL. Existing Python identifiers,
  owner runtime and legacy database compatibility remain; do not rewrite them
  or migrate data as a side effect of this handoff. Recent Python changes are
  test-only synthetic compatibility fixtures.
- Login/SSO/provider integration and ChatGPT subscription integration are not
  delivered by this personal slice. Never infer a provider login from the
  successful synthetic signed-token fixtures.

The broader FA/MU direction includes teams collaborating on incidents from local
Codex/chat sessions or the application, with a permission-filtered index and an
organization-wide federated wiki. This personal handoff is the selective research
edition work, not a claim that the entire enterprise backlog is complete. Reviewed
GitHub gold-set exports are downstream of database authority; daily automation
for all personal research objects was not configured by this slice.

## Published review state

These are **open draft review candidates**, not merged or deployed releases.
Source, runtime data and deployment are separate. Recheck links for newer state.

| Review | Branch / base | Recorded implementation checkpoint |
| --- | --- | --- |
| [Atlas8: integration](https://github.com/justin-napolitano/atlas/pull/8) | `feat/atlas-personal-collaboration` -> `main` | `b0b0a3826e7ab84ac7f489b1513e9b81a3108c28`; 14/14 checks passed |
| [Atlas5: reader/writing](https://github.com/justin-napolitano/atlas/pull/5) | `feat/atlas-reader-experience` -> `review/atlas-personal-base` | `78f801165e94bd58dd2412f3a3f1d206a30c4c34`; green |
| [Atlas6: Go notes](https://github.com/justin-napolitano/atlas/pull/6) | `feat/atlas-notes-sync` -> `review/atlas-personal-base` | `f3c15a08af111c2e2d47507440570d8ca4b34016`; green |
| [Atlas7: typed research](https://github.com/justin-napolitano/atlas/pull/7) | `review/atlas-research-sync` -> `feat/atlas-notes-sync` | `708381f`; green |
| [MU19: research service](https://github.com/digital-group-vaults/MU-TH-UR/pull/19) | `feat/atlas-research-sync` -> `feat/MU-0007-frontmatter-search` | `b391fefb661f65d7f09abaf0efc120e78892dc68`; 28/28 checks passed |
| [MU18: required parent](https://github.com/digital-group-vaults/MU-TH-UR/pull/18) | `feat/MU-0007-frontmatter-search` -> `feat/MU-0015-collaboration-stack` | `ce178bde42eee8ad31a0768e16c656b6a38824e3` |

This handoff and follow-up planning are documentation added after the tested
Atlas implementation checkpoint. Do not confuse its later docs commit with an
unrecorded runtime change. Consult current checks for the branch's latest head.

**Merge plan:** review MU19's parent stack recursively before merging it; its
base is not MU main. Atlas8 is the combined personal merge unit. Atlas5/6/7 are
focused code reviews already composed in Atlas8: reconcile/close them after the
integration, rather than independently merging duplicate stacks. The fixed
personal review base preserves existing `a2ff33d` (scripture-removal checkpoint),
which is also in Atlas8 ancestry. No reset/force-push or copying that old local
commit is needed. Verify current bases/mergeability, and preserve newer work if
another session has progressed them.

## Fresh checkout and prerequisites

Use normal GitHub authentication on the new machine. The MU repo requires the
appropriate organization access. No workstation-specific auth wrapper is part
of the setup and no token belongs in a clone URL, issue or checked-in file.

From an empty directory chosen for source checkouts:

```sh
git clone --branch feat/atlas-personal-collaboration https://github.com/justin-napolitano/atlas.git atlas
git clone --branch feat/atlas-research-sync https://github.com/digital-group-vaults/MU-TH-UR.git muther
```

For an existing checkout, inspect `git status`, fetch, and select the appropriate
branch without overwriting local changes. On a fresh clone these branches
contain the code; no original workstation paths or `.swarm` folders are needed.

Tooling: Go **1.26.10** satisfies both repos (Atlas's module minimum is 1.26.5;
MU requires 1.26.10), C compiler/CGO for native SQLite and race tests, Node 24/npm,
Git/GitHub CLI, and a running Docker daemon for disposable PostgreSQL tests.
Existing compatibility checks also use the locked uv/Python environment in
[development.md](development.md). Native shell builds need the platform's
additional Rust/Tauri or Electron toolchains; existing desktop shells target
macOS, and other native platforms are not established by these checks.

## Build and validate without owner data

Run from the new `atlas` checkout; keep these variables in the same terminal:

```sh
ATLAS_HANDOFF_REPO="$(pwd)"
ATLAS_HANDOFF_TOOLS="$(mktemp -d)"
go version
npm ci --prefix web --no-audit --no-fund
npm test --prefix web
npm run build --prefix web
go test -race ./...
go vet ./...
go run ./tools/federation-conformance -sha256 2c049db2a40b1db9047588c327e711c23e49d1f571386723d75ab7940d129101
go build -o "$ATLAS_HANDOFF_TOOLS/atlas-federation-workspace" ./tools/federation-workspace
go build -o "$ATLAS_HANDOFF_TOOLS/atlas-federation-replica-probe" ./tools/federation-replica-probe
```

Then from the sibling `muther` checkout, with Docker running:

```sh
MUTHUR_RUN_RESEARCH_TEST=1 ATLAS_RESEARCH_TEST_DIR="$ATLAS_HANDOFF_REPO" \
  go test -race ./internal/researchsync \
  -run 'TestDockerFixtureSeparatesPullProgress|TestPostgresResearchHTTP' -count=1 -v
```

The test creates/removes its own synthetic PostgreSQL container and actual
personal SQLite clients. It does not accept an existing hosted/owner DB URL.
`MUTHUR_RUN_RESEARCH_TEST` is the current research flag spelling; the separate
runtime/browser flags use `MUTHER_RUN_POSTGRES_TEST` and `MUTHER_TEST_RESEARCH`.
The MU CI pins an older reviewed public client SHA for reproducible contract
parity; the command above deliberately validates the selected local Atlas head.
Change CI pins intentionally when contracts/required acceptance change.

For the full compiled two-user browser loop, install/select a reviewed Playwright
toolchain separately (recorded run used 1.64.1) and a real Chromium executable.
Use the exact environment/command in
[personal-joint-acceptance.md](personal-joint-acceptance.md), setting:

- `FATHUR_WORKSPACE_BROWSER_SCRIPT` to the new Atlas checkout's
  `web/src/federation/workspace.browser.mjs` (legacy fixture flag spelling).
- `ATLAS_WORKSPACE_BINARY` to the newly built executable above, and
  `ATLAS_WORKSPACE_ASSETS` to the new checkout's `web/dist`.
- Explicit `PLAYWRIGHT_MODULE` and `PLAYWRIGHT_CHROMIUM_EXECUTABLE` paths for
  this machine. Keep browser sandboxing; no old temporary binary is available.

The fixture generates signed synthetic identities and controls outage/revoke
handshakes. Do not substitute real tokens, an owner database or an insecure
authentication bypass. For optional legacy/native checks, use development.md
and the current workflows. PostgreSQL legacy tests require an explicitly
disposable `RESEARCH_TEST_DATABASE_URL`; without it, those tests skip, which is
not equivalent to full database acceptance.

## Actual operating state and enablement

The normal owner research/e-reader experience remains the default. Shared mode
is the Go loopback launcher at `workspace.html?collaboration=1`, with explicit
private mode-0600 configuration, scoped credentials and account/brain selection.
See [personal-notes-sync.md](personal-notes-sync.md) for complete configuration,
fresh launch-file behavior, replica identity, snapshot/restore and private paths.

Research requires **both** trusted Atlas account `research_enabled: true` and
MU `--research`, after reviewed migration `0012_research_sync.sql` and its
dependencies. MU does not auto-migrate/seed at startup. See MU
`docs/atlas-research-sync.md` and `docs/runtime.md` for roles, TLS, identity and
configuration. Runtime's current RFC9068 `typ: at+jwt` profile is narrower than
general OIDC/Entra token formats; an actual approved identity/gateway profile
and environment must be established before real-data hosted use. A successful
test login is not delivered SSO. This handoff does not authorize a deployment.

**Source transfer is not data transfer.** GitHub does not contain owner notes,
research library/attachments, private SQLite databases or WALs, backups, tokens,
runtime configurations, old one-time launch codes or temporary browser artifacts.
If existing data is needed on the other computer, transfer it separately through
the owner's verified private backup/restore process. Do not commit/upload it to
this public repo. A live SQLite-file copy is not a verified snapshot. The owner
database, note replica and research sidecar are different stores; do not point
one tool at another's database or reuse another device/identity's replica file.
Fresh device setup uses its own explicit stable device identity and paths.

## Implemented versus remaining

Implemented: opt-in Go note sync/SQLite replicas; shared research collections and
membership; explicitly shared immutable text source versions and exact Unicode
selectors; private annotations by default with explicit initial sharing; private
per-user reading positions; exact operation retries, durable receipts, reviewed
conflicts, scoped navigation/export, offline cache labels, and persistent cache
read tickets preventing older concurrent refreshes from replacing newer state.
Existing owner reader/writing improvements are composed, not replaced.

Limits to carry into the next work:

- Existing owner notes/research are **not** mapped/migrated to brains yet.
  The note-replica `preview` command is metadata/counts only, not that mapper.
- Source upload currently accepts explicit text excerpts up to 256KiB; snapshots
  are bounded at 1000 visible records/3MiB. No binary/PDF sharing or broad paging.
- Annotation visibility is fixed at creation. Publishing a private annotation
  requires an explicit separate shared annotation, not silently changing it.
- Unsent research forms survive scope navigation in browser memory, with warning
  and export/discard. They are **not crash-durable before first submission**.
  Submitted operations/receipts are durable in separate identity-bound SQLite.
- Research proposals from an old service generation stay retained/exportable;
  guided remapping/new-operation review is not implemented. Note sync's separate
  generation handling must not be mistaken for this missing research workflow.
- No packaged native-app acceptance, production enablement or owner-data migration
  is claimed by browser/unit tests. Login/SSO and model-provider integration remain
  outside this scope.

## Ready-to-pick-up queue

All follow-ups are open, assigned to Justin, and currently **unreserved**. Each
issue defines acceptance, scope, dependencies and a PR plan. Estimates describe
planning effort, not guarantees. Build from the reviewed integration branch or
main that contains it; before merge, stack new Atlas PRs onto the integration.

| Priority / issue | First deliverable | Dependency / ownership |
| --- | --- | --- |
| [9: dev/test rollout](https://github.com/justin-napolitano/atlas/issues/9) | Review stack and select environment/test identity, then evidence-backed dev/test deployment | Environment/identity choice and review required; deployment/config/docs lane |
| [10: owner migration](https://github.com/justin-napolitano/atlas/issues/10) | Go read-only snapshot mapper + deterministic dry-run plan; apply later after selected-plan review | Can start with synthetic fixtures now; new migration tool/package, coordinate IDs/contracts |
| [13: durable unsent drafts](https://github.com/justin-napolitano/atlas/issues/13) | Local Go/SQLite research drafts before submission, recovery after restart | Can start now; local store/bridge + personal form lifecycle |
| [12: generation review](https://github.com/justin-napolitano/atlas/issues/12) | Explicit old/new proposal comparison and reviewed fresh operation with preserved evidence | Serialize shared client/UI edits with13; no blind replay |
| [11: full libraries](https://github.com/justin-napolitano/atlas/issues/11) | Paged contract and explicit full-source/attachment design before provider/storage implementation | Contract/storage/quota decisions; coordinate source IDs with10 and recovery |
| [14: native acceptance](https://github.com/justin-napolitano/atlas/issues/14) | Reproducible selected-shell package/install/upgrade/two-device evidence | Separate harness/packaging lane; synthetic workspace only |

Suggested next parallel batch: migration-preview tool, durable-draft store and
native acceptance. One integrator owns entry/CLI/shared contract changes. Run the
generation UI lane after the draft lane, or explicitly split new files and have
one integrator compose their shared client changes. Dev/test environment decisions
can proceed alongside coding; do not invent missing targets or credentials.

## Reservations and PR handoff protocol

There are no active old worker leases. GitHub comments here are **manual**
reservations, not atomic TaskFlow leases. Before work, read the issue's latest
comments/PRs and claim worker ID, exclusive paths, branch, actual base SHA and UTC
expiry (a short bounded window), plus dependencies. Do not infer ownership from
the old 07:00 timestamp or assume an expired reservation proves a branch abandoned.
Coordinate overlaps; never overwrite another session's changes.

Personal commits use the real `Atlas #<issue>` reference. MU work must follow its
current repo rules and actual existing task lineage (the current service stack
uses MU-0015); do not invent a Jira number. Every draft PR records problem and
behavior, owning issue, base/dependencies, touched scope, tests actually run,
skips/limits, schema/data impact and rollback where relevant. Release reservations
with final SHA/PR/evidence and one concrete next action. Review and merge status
are not synonymous with implementation checks passing.

## Evidence and what must be reproduced

Recorded implementation `b0b0a38`: 192 frontend tests, 484 local legacy tests on
disposable PostgreSQL 17.11, Go race/vet and 34 canonical cases; Atlas PR8 CI 14/14;
MU PR19 at `b391fef` CI 28/28. Actual two-user PostgreSQL/JWT/HTTP/native-SQLite/
Chromium acceptance and mobile layout passed; exact command/input hashes and
historical run limits are in personal-joint-acceptance.md. Later SQLite/HTTP
regressions cover offline pending recovery and concurrent refresh ordering.
Native policy/lifecycle/audit checks passed; that is not native app acceptance.

Old raw logs/screenshots were temporary and are **not** transferable GitHub
artifacts. Regenerate them using the fixture on this machine if needed; do not
depend on their old paths. CI checks/logs are linked from the PRs. Re-run relevant
checks after changes, and distinguish historical tested checkpoints from the
new head instead of treating this document as an everlasting green result.

## Starter prompt for the next agent session

> Continue personal Atlas from GitHub issue #4 and
> docs/personal-machine-handoff.md on feat/atlas-personal-collaboration. Read
> AGENTS.md/SECURITY.md, current issues/PRs and dependencies before acting.
> Preserve personal research/e-reader and private defaults; new backend code Go.
> No real-data upload/migration, merge or deployment is implied by reading the
> handoff. Pick the requested next issue, reserve exact paths with a fresh expiry,
> and implement its stated phase/acceptance using synthetic data. Keep GitHub
> issues canonical, record PR/base/SHA/test evidence and release reservations.
