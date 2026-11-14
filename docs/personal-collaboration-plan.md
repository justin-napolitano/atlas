# Personal Atlas collaboration plan

Canonical execution tracker: https://github.com/justin-napolitano/atlas/issues/4

For a fresh computer or agent session, start with
[personal-machine-handoff.md](personal-machine-handoff.md). It records published
branches, exact checkpoints, setup, remaining issues and the current reservation
protocol. The initial worker reservations below are historical and released.

Atlas keeps research groups, its general e-reader, source references, exact passage
anchors, private notes and existing local storage. Generic Go collaboration and
writing improvements are selectively ported from the reviewed sibling application.
The corporate notes-only interface is not the personal product configuration.

## Boundaries

- Brains are access boundaries; research groups are collections within a brain.
- Notes retain Markdown/frontmatter, stable IDs, exact text and revision history.
- Immutable source/document versions retain content hashes and explicit uploads.
- Annotations carry exact source/version/hash/selector context; sharing is explicit.
- Reading progress belongs to a user. One reader cannot move another's position.
- Private annotations, private groups and existing owner data never silently become
  shared. A group label or frontmatter edit cannot grant access.
- Existing owner-to-brain migration requires snapshot, mapping preview, verification
  and rollback. Initial sync is opt-in using separate real SQLite replicas.
- New backend/transport/store code uses Go and SQL; existing compatibility runtime
  remains intact. No new Python implementation or provider calls.

## Parallel lanes

| Issue | Worker | Exclusive scope | Review base |
| --- | --- | --- | --- |
| [#1](https://github.com/justin-napolitano/atlas/issues/1) | atlas_reader | Existing owner/reader UI, models and isolated browser fixtures | a2ff33d |
| [#2](https://github.com/justin-napolitano/atlas/issues/2) | atlas_notes_sync | Go federation core, launchers, scoped federation client and Go module | a2ff33d |
| [#3](https://github.com/justin-napolitano/atlas/issues/3) | atlas_research_sync | Typed research client/store, canonical service extension and migration0012 | a2ff33d / MUce178bd |
| [#4](https://github.com/justin-napolitano/atlas/issues/4) | root | Entry/runtime wiring, integration, issue/PR handoff | a2ff33d |

Manual reservations end2026-11-08 07:00UTC and must be released or renewed before
another executor takes over. They are not native atomic leases. Human owner stays
Justin. Work happens in isolated worktrees; personal main and the live library are
not modified by testing. The existing unpublished a2ff33d commit is retained in the
candidate ancestry, not force-pushed to main.

## Acceptance and PR plan

Focused draft PRs retain exact source pins, dependencies, tests and gaps; root
composes accepted checkpoints in an isolated integration branch. Module path is
github.com/justin-napolitano/atlas; imported contract provenance must remain pinned.
New server capabilities stay default-off and receive verified identity from the
existing authentication boundary, never client-supplied actor IDs.

Use synthetic disposable libraries/databases. Joint tests must exercise actual
PostgreSQL, HTTP, independent SQLite replicas and compiled browser surfaces:
private/team notes, offline concurrency, exact retries/restart, explicit merge,
revocation and retained writing, generation changes, group membership, immutable
versions/anchors, private/shared annotations and per-user progress. Reader UX must
preserve position, source-to-note context, quotes, Unicode/CRLF and native IME/undo.
A mock-only suite is not complete multiuser acceptance.

Root publishes only review candidates; merge, schema/security approval, real data
migration, hosted SSO and deployment are distinct gates. No application deployment
is implied by deploying worker agents.

## Delivered candidate and enablement

The normal owner workspace still opens by default. The separate collaboration
launcher opens `workspace.html?collaboration=1`; it accepts only a private trusted
configuration and scoped credentials, never a browser-supplied server or actor.
See `personal-notes-sync.md` for configuration and replica setup. Setting an
account's `research_enabled` to true enables its research desk only after selecting
that account and brain. The service also requires the reviewed migration0012 and
explicit `muther --research` flag. None of these flags is enabled automatically.
The supporting service candidate is MU-TH-UR PR19.

Research sidecars are separate from owner databases and note replicas. The launcher
derives each path from the configured private replica path and selected brain;
the sidecar itself binds server/org/brain/user identity. The launcher caps open
research sidecars at128. Offline recovery uses explicitly stale cached research
only after transient failures, under the existing selected-brain gate; a denied or
invalid response never falls back to cached data. Pending operations survive
restart, and unknown saves retain an immutable retry. Only a confirmed conflict
can be explicitly resolved; its original payload and receipt remain in SQLite.

This is the first opt-in collaboration slice. Existing owner research is not yet
mapped or migrated into brains. Source sharing currently accepts explicit text
excerpts up to256KiB; rich local reading remains available in the owner edition.
Large libraries, binary/PDF sharing, pagination beyond snapshot budgets, native
shell acceptance and production identity/deployment remain follow-up work. After
a service-generation change, retained research proposals require export and
manual review; no automatic remapping or blind replay into a new generation is
provided. Keep the tracker open through review and these rollout decisions.

## Evidence

`personal-joint-acceptance.md` records the real two-user browser acceptance command
and exact tested input hashes. Go race tests, vet and34canonical conformance cases
pass;192frontend tests and the production build pass. Public extraction checks
found no private data and no bundled reader resources. These checks use synthetic
disposable data and do not certify native desktop or production acceptance.
