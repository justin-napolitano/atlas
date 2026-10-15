# Hosted release evidence and open launch gates

Status: combined source candidate; **not deployed and not launch complete**. The scope is the original #30 roadmap and the first-release acceptance in #42, including Q 4:59 verse/commentary reading, a scoped definition or definition gap, and a bounded article. Passing infrastructure mocks or isolated browser/API tests does not satisfy those research or live-operation requirements.

## Integrated source

This branch combines the application stack through PR #75 with the infrastructure branch from PR #61. It resolves the README index conflict by retaining both documentation sets. The existing component PRs remain independently reviewable; this integration does not merge them into `main`, change the authoritative RDF, publish research, or provision resources. The pre-existing dirty frontend experiment and harvested data in the original worktree are not integration inputs.

The workflow `.github/workflows/hosted-release-validation.yml` calls the actual PostgreSQL, frontend/browser, Terraform/security, and graph workflows rather than copying their test commands. Local relative reusable workflows use the caller's commit, as documented by [GitHub](https://docs.github.com/en/actions/how-tos/reuse-automations/reuse-workflows). The caller grants only repository contents read and passes no secrets or cloud identity. Its aggregate check fails when any required workflow fails, is cancelled/skipped, or is missing. The summary explicitly distinguishes source verification from deployment and launch verification.

The integration workflow runs on changes to itself or this evidence ledger and can also be dispatched against a selected Git ref after it is available on the default branch. Individual component workflows keep their normal change filters. Before a release, rerun combined verification against the **exact candidate ref**; do not reuse older green checks after changing source. GitHub runner tests use isolated synthetic databases and browser fixtures. They do not establish compatibility with a configured Cloud SQL IAM deployment.

## Source checks

| Area | Evidence supplied by combined CI | Scope limit |
| --- | --- | --- |
| PostgreSQL | All existing contracts on 17 and 18, real restricted-role saves, CAS conflicts/history, private passage selectors, public approval/withdrawal | Ephemeral isolated PostgreSQL, not Cloud SQL IAM or a production capacity test |
| Native database logs | Synthetic private bound-value marker absent; sentinel and error paths present; shared flags enforced | Cloud SQL pgAudit literal masking and extension installation still require live verification |
| Owner/public API | Signed synthetic IAP assertions, anonymous/non-owner denial, CSRF/origin/write boundary, public route exclusion and approved-head reads | No live IAP/OAuth session or browser cookie flow |
| Reading/publication UI | Frontend contracts, production build, owned headless Chrome reading/notes/selection/search/publication/conflict/mobile flows | Synthetic API interception; no actual multi-machine hosted editing |
| Graph/semantic | SHACL and deterministic canonical exports, pinned Ossie/model/policy checks | Structural correctness is not scholarly review, semantic completeness, or a graph-authority cutover |
| Infrastructure | Formatting/schema validation, six credential-free mock plans, exact SQL logging flags, Checkov policy checks | Not a credentialed cloud plan/apply, live cost/capacity proof, backup restore, or completed security review |

Record the successful run URL, tested commit, and actual results in the issue/PR after CI finishes. This ledger intentionally does not hardcode a self-referential future commit hash or claim a run before it exists.

## First-release acceptance remains intact

| Requirement from #42 | Current evidence | Still required |
| --- | --- | --- |
| Owner signs in from two independent machines/profiles | Signed-token boundary tests and revision-safe PostgreSQL storage | Actual GCP/IAP setup, two live authenticated sessions, server restart/reconnect and cross-device verification |
| Read Q 4:59 with identified Arabic/translation resource and located commentaries | Existing bounded RDF pilot and source links; private excerpt reader | Verse/edition/commentary reader and an actual complete hosted reading path (#43/#45) |
| Select tafsīr or an ulū al-amr occurrence and create/reuse a scoped concept | Unicode-anchored term candidates and retained edition/locator | Lexical forms/senses, attributed definition or explicit gap, concept linkage and usable UI (#44/#46) |
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
