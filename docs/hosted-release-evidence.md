# Hosted release evidence and open launch gates

Status: combined source candidate; **not deployed and not launch complete**. The scope is the original #30 roadmap and the first-release acceptance in #42, including Q 4:59 verse/commentary reading, a scoped definition or definition gap, and a bounded article. Passing infrastructure mocks or isolated browser/API tests does not satisfy those research or live-operation requirements.

## Integrated source

The working-reader integration combines persistent highlight/underline/margin
styles, universal source-intake receipts, the bounded article preset and attributed
Q 4:59/Q 4:83 Arabic resource, saved passage-to-verse links and scoped material
navigation, and explicit server-backed per-project reading bookmarks. The reader
opens the exact stored document/annotation after source intake or following a
verse connection. Passage mark style and source-resource notice are retained
together in private exports and the combined runtime grants. Private semantic
metadata includes both verse materials and reading desks; joins describe lineage,
not scholarly entailment. OpenAPI is regenerated from the combined executable API.
The authenticated owner image and disabled-by-default native-IAP/private-SQL cloud
configuration are included in the same source candidate. None of these merges
provisions resources, establishes a live owner session, promotes review, or
publishes private reading state. Real restricted PostgreSQL, combined browser and
actual owner/public image checks must pass against this integration's exact ref;
earlier component checks do not establish the merged result.

This branch combines the application stack through PR #75 with the infrastructure branch from PR #61 and the current `main` nightly public-snapshot commit (`ea769a9`). It resolves the README index conflict by retaining both documentation sets and retains that already-published snapshot unchanged. The existing component PRs remain independently reviewable; this integration does not merge them into `main`, change the authoritative RDF, publish research, or provision resources. The pre-existing dirty frontend experiment and harvested data in the original worktree are not integration inputs.

The workflow `.github/workflows/hosted-release-validation.yml` calls the actual PostgreSQL, frontend/browser, Terraform/security, and graph workflows rather than copying their test commands. Local relative reusable workflows use the caller's commit, as documented by [GitHub](https://docs.github.com/en/actions/how-tos/reuse-automations/reuse-workflows). The caller grants only repository contents read and passes no secrets or cloud identity. Its aggregate check fails when any required workflow fails, is cancelled/skipped, or is missing. The summary explicitly distinguishes source verification from deployment and launch verification.

The integration workflow runs on changes to itself or this evidence ledger and can also be dispatched against a selected Git ref after it is available on the default branch. Individual component workflows keep their normal change filters. Before a release, rerun combined verification against the **exact candidate ref**; do not reuse older green checks after changing source. GitHub runner tests use isolated synthetic databases and browser fixtures. They do not establish compatibility with a configured Cloud SQL IAM deployment.

## Source checks

| Area | Evidence supplied by combined CI | Scope limit |
| --- | --- | --- |
| PostgreSQL | All existing contracts on 17 and 18, real restricted-role saves, CAS conflicts/history, private passage selectors, public approval/withdrawal | Ephemeral isolated PostgreSQL, not Cloud SQL IAM or a production capacity test |
| Native database logs | Synthetic private bound-value marker absent; sentinel and error paths present; shared flags enforced | Cloud SQL pgAudit literal masking and extension installation still require live verification |
| Owner/public API | Signed synthetic IAP assertions, anonymous/non-owner denial, CSRF/origin/write boundary, public route exclusion and approved-head reads | No live IAP/OAuth session or browser cookie flow |
| Owner service delivery | Separate bounded frontend, signed-owner page/asset tests, isolated real Linux image runtime/OS/Python/npm scan, native-IAP/private-SQL Terraform contracts | No pushed image, credentialed cloud plan, live identity/database connection, or release approval |
| Reading/publication UI | Frontend contracts, production build, owned headless Chrome reading/notes/selection/search/publication/conflict/mobile flows | Synthetic API interception; no actual multi-machine hosted editing |
| Graph/semantic | SHACL and deterministic canonical exports, pinned Ossie/model/policy checks | Structural correctness is not scholarly review, semantic completeness, or a graph-authority cutover |
| Infrastructure | Formatting/schema validation, six credential-free mock plans, exact SQL logging flags, Checkov policy checks | Not a credentialed cloud plan/apply, live cost/capacity proof, backup restore, or completed security review |

Record the successful run URL, tested commit, and actual results in the issue/PR after CI finishes. This ledger intentionally does not hardcode a self-referential future commit hash or claim a run before it exists.

The [owner delivery slice](owner-service-delivery.md) adds the owner-container
workflow to the required aggregate alongside the existing public-container gate.
Its optional native-IAP and IAM SQL sidecar configuration is disabled by default;
the expanded infrastructure suite has fourteen credential-free mock tests. An
image/scanner result is source evidence, not a live IAP, Cloud SQL, cost or recovery
verification. Personal Google projects require initial Console OAuth setup as
documented in the runbook; no authentication bypass substitutes for it.

An intermediate candidate's browser failed to expose its owned debug port within the former ten-second startup window, and the aggregate correctly failed despite the other components passing. Cold runner startup now has a bounded thirty-second observation window for the same process; UI waits and assertions are unchanged. A startup timeout retains bounded stderr diagnostics. No browser retry, sandbox disabling, test suppression, or skipped-check waiver was added. This addresses the observation budget and diagnostics; it does not establish the cause of slow runner startup.

The follow-on [approved release exporter](public-release-export.md) supplies restricted-login capture, independently verified immutable artifacts and public-only Ossie metadata. The [public viewer](public-viewer.md) consumes that format with project/record navigation, review limits and empty-withdrawal handling; it does not build/deploy an isolated public image. Withdrawal locking covers local capture/activation only; head freshness at remote deploy and cache withdrawal remain open. These tests are additional evidence, not a replacement for the complete combined release gate or live launch requirements below.

The [isolated site builder](public-site-build.md) now packages one verified approved release, a guarded public-only frontend and a database-free read-only Node runtime. Its tests use the actual compiled artifact over HTTP and in Chrome under the runtime CSP. The portable directory is not yet a scanned container image or a deployed service; deployment freshness, scheduler, cache withdrawal, live recovery and domain-reading gates remain open.

The follow-on [container delivery configuration](public-container-delivery.md) supplies an approved-only image context, pinned base/scanner, synthetic Linux image build/scan/SBOM and actual-container Chrome checks. The combined gate now also requires this container workflow. Optional Cloud Run configuration defaults to no runtime and supports a private candidate before explicit anonymous visibility; it is a mock-validated design, not a credentialed plan or deployment. No image is pushed. Deployment freshness, scoped publisher identity, withdrawal/cache handling, scheduling, live recovery and full domain acceptance remain open.

The [located Qur’an reference slice](quran-reference-capture.md) adds offline numeric/list/range and bounded English narrative detection, an attributed structure profile, immutable source/marker provenance, private revisioned owner confirmation/correction/dismissal, manual mapping, reverse verse-to-passage lookup, and private JSON-LD reference export. Restricted PostgreSQL roles and real HTTP/storage round trips are tested; browser controls separately use synthetic authenticated API responses. Private Ossie metadata describes the project-scoped source/passage/reference lineage. No detection or confirmation promotes scholarly review, creates a canonical graph edge, or publishes selected text. This does not complete scripture/translation/commentary reading, concept definitions, or the actual hosted Q 4:59 acceptance flow.

## First-release acceptance remains intact

The [lexicon reader](lexicon-reader.md) now consumes those owner APIs for exact
word-to-concept capture, attributed definitions, source reopening, pending/gap
states, correction conflicts/history, and paginated private reading occurrences.
Its compiled browser checks cover retained/uncertain drafts, saved-link reload,
Arabic/RTL, dark/mobile layout, and explicit remote-state handling using synthetic
authenticated responses. The API/storage has separate real PostgreSQL evidence.
These complementary checks are not a live hosted session, newly reviewed pilot
definition, public lexical publication, or proof of the complete Q 4:59 reader.

The [private scoped lexicon API](scoped-concept-lexicon.md) adds separate entries,
forms, source-grounded written representations, scoped senses, definition
assertions, and exact occurrences, reusing existing concept IDs. Runtime-role
tests cover capture retries/concurrency/rollback, variants, canonical concept
preservation, definition gaps, CAS corrections and history, scoped retrieval, and
public-projection exclusion. The private Ossie contract includes their source
lineage. The reader has complementary compiled browser evidence above. Neither
backend nor synthetic-browser checks establish public lexical publication,
reviewed definitions, or actual hosted operation; those remain explicit
first-reading-release work under #42/#44.

| Requirement from #42 | Current evidence | Still required |
| --- | --- | --- |
| Owner signs in from two independent machines/profiles | Signed-token boundary tests and revision-safe PostgreSQL storage | Actual GCP/IAP setup, two live authenticated sessions, server restart/reconnect and cross-device verification |
| Read Q 4:59 with identified Arabic/translation resource and located commentaries | Existing bounded RDF pilot and source links; private excerpt reader | Verse/edition/commentary reader and an actual complete hosted reading path (#43/#45) |
| Select tafsīr or an ulū al-amr occurrence and create/reuse a scoped concept | Located lexical entries/forms/senses, private concept/definition reader, retained source provenance, explicit gaps and pending review | Live two-session pilot with reviewed definition or recorded gap, concept relations/redirects, public lexical projection, and the remaining #44/#46 acceptance |
| Durable notes, progress, screening, evidence navigation and return | Restricted-role CAS storage and compiled browser flows; explicit single-note Obsidian round trip | Hosted discovery screening/authoring integration and actual restart/cross-device demonstration (#35/#40) |
| Concurrent edits and interrupted saves preserve both versions | Database races, stale revision checks, retained drafts and explicit comparison in browser tests | Live independent-session interruption/conflict drill |
| Explicitly publish bounded article/verse/concept material | Sealed selected projections, digest/source/head approval checks, review screen and withdrawal | Article/verse/concept workflows and an approved-head exporter, immutable delivery, public derived-view privacy checks (#41/#43–47) |
| Scholarly attribution, disagreement, exact source context and honest scope | Editorial methods, unchanged pilot IDs/locators, preserved limited review labels | Manual source recheck and one owner-reviewed bounded pilot article (#15/#50), with uncertainty and rights recorded |
| Accessible desktop/mobile/Arabic/dark UX and older-Mac performance | Keyboard pane resize, focus movement, Unicode/Arabic selection, dark/mobile browser checks | Full verse/concept/article accessibility, mixed-direction reading, and measured real-device performance (#51) |
| Backup restore, failed-publication fallback, rollback and runbook | Reviewable foundation with backup/PITR configuration and immutable-delivery design | Live measured restore; exporter/build/deploy; failure/rollback/withdrawal drills; operational URLs/resources/costs/runbook (#31/#41/#42) |
| Explicit evidence gaps and review limitations | Separate review/publication/reading axes; no implementation-driven review promotion | Keep the launch report current with actual observed gaps; do not claim specialist peer review or full corpus coverage |

## Environment and release decisions still needed

Choose the real GCP project/billing/region and sole-owner Google identity, establish private Terraform state, inspect a credentialed complete plan/cost worksheet before any billable apply, and complete OAuth/IAP configuration. Verify migration ownership, real IAM role membership compatibility, connection budgets, runtime routes, publisher deployment permissions, and Cloud SQL-specific logging. No actual project/account values or secrets belong in this repository.

Review the security-sensitive API, SQL `SECURITY DEFINER`, public projection, and runtime infrastructure boundaries before launch. See [platform threat model](platform-threat-model.md), [publication threat model](publication-threat-model.md), [SQL permissions](runtime-sql-permissions.md), [publication](publication.md), and [GCP foundation](../infra/gcp/README.md). No independent security review or exception approval is claimed here.

After the bounded first reading release, the remaining #30 roadmap still includes configurable/persisted ranking, richer semantic/entity search, resumable research runs, scoped agent proposals, fuller Obsidian sync and portable archive round trips, sourced lexical/historical usage, external references, complexity/preparation, and author/school/literature maps. Integrating the current stack does not redefine these requirements away.
