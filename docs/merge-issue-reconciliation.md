# Workspace merge and issue reconciliation

## Current reconciliation — 2026-10-17

The owner authorized merging the open stack and reconciling the issues before
further implementation. All 12 previously open PRs merged into main in dependency
order, retargeting each dependent to main and matching its checked head:

| PRs | Integrated work |
| --- | --- |
| #148, #150, #151, #152, #153 | Private writing recovery, status, bounded tabs, Trash and capture recovery identity |
| #155, #157 | Free margin writing, formatted Markdown sidebar and highlight-to-note navigation |
| #159, #161 | Appearance preferences and actual full-app font/zoom repair |
| #163, #167 | Document-first reading/writing and compact notebook explorer |
| #171 | Qur’an-first reading and seamless catalog plan |

#149 was already merged. The final application merge
[`21390a9`](https://github.com/justin-napolitano/islam-research/commit/21390a91aba1c70d5653ff7068c524115a864d2d)
passed main [reading/browser](https://github.com/justin-napolitano/islam-research/actions/runs/39054016648),
[public container](https://github.com/justin-napolitano/islam-research/actions/runs/39054016722)
and [owner container](https://github.com/justin-napolitano/islam-research/actions/runs/39054016703)
checks. The final backend-bearing integration `aa6cda3` passed real
[PostgreSQL 17/18 contracts](https://github.com/justin-napolitano/islam-research/actions/runs/39053946986).
The subsequent #171 merge is planning documentation. Main retained its newer nightly
public snapshot; the checked stack's application source, tests and workflows were
not replaced by older data. No branch deletion or destructive reset was needed.

Completed bounded software issues #135/#136/#137/#145 and #162/#165 were closed
with evidence. #154/#156/#158/#160 closed through their merge links. #134 is closed
as a superseded planning checklist; [#84](https://github.com/justin-napolitano/islam-research/issues/84)
is the authoritative product roadmap, with #30 retained as the technical umbrella.
Parent epics, #15 scholarly pilot, #146 owner session, #31/#33/#42 hosted gates,
#139 custom folders and deferred features remain open.

Next implementation is **#172 → #173 → #174**, coordinated with #164:
identified Qur’an resources, continuous reading, and verse/source-bound private
notes. Hosted cross-device release follows the real reading checkpoint; general
catalog adapters and additional book structures follow that core experience.
See [the current roadmap](second-brain-roadmap.md). Roadmap labels were reconciled;
labels are delivery order, not proof of release or scholarly review.

This pass merges existing software and updates planning. It does not implement the
continuous full Qur’an reader, deploy GCP/PostgreSQL, establish real cross-device
sync, change source permissions, or complete the scholarly review. Existing
migration/grant/security review and hosted launch requirements remain in force.

## Historical audit — 2026-10-16

Audit date: 2026-10-16 UTC (2026-10-15 evening in the owner's timezone). The owner authorized merging all outstanding PRs and reviewing the issues. This records code integration and backlog decisions, not deployment or completion of scholarly research.

Subsequent owner-approved prioritization: [the current Now / Next / Later plan](second-brain-roadmap.md) adds trash/restore #145 and a real reading-session checkpoint #146. It defers advanced ranking/history, agent expansion, full Obsidian sync, and elaborate graph exploration beyond the first release. The merge/closure evidence below is retained as the historical audit.

## Integrated workspace

| PR | Integrated scope |
| --- | --- |
| [#122](https://github.com/justin-napolitano/islam-research/pull/122) | Reader A connected research workspace |
| [#123](https://github.com/justin-napolitano/islam-research/pull/123) | First-class notebook, Markdown writing, and note graph |
| [#124](https://github.com/justin-napolitano/islam-research/pull/124) | Fluid notebook and source navigation |
| [#129](https://github.com/justin-napolitano/islam-research/pull/129) | Sources, Questions, and Notes destinations with direct navigation |
| [#131](https://github.com/justin-napolitano/islam-research/pull/131) | Project directories and inline project creation |
| [#133](https://github.com/justin-napolitano/islam-research/pull/133) | Project tree and retained working tabs |
| [#142](https://github.com/justin-napolitano/islam-research/pull/142) | Academic second-brain priorities and planning documentation |

The stack was merged in that order, with dependent PRs retargeted to main. GitHub marked prototype [#121](https://github.com/justin-napolitano/islam-research/pull/121) merged because its commits were already in #122. No separate prototype merge or closure was needed.

Integrated application commit: [`051c782e291d21888573202733279be587388b0f`](https://github.com/justin-napolitano/islam-research/commit/051c782e291d21888573202733279be587388b0f). Planning documentation then merged at [`f64bdbe716ff81b12c0d08c49b1139c05f0a3e0f`](https://github.com/justin-napolitano/islam-research/commit/f64bdbe716ff81b12c0d08c49b1139c05f0a3e0f).

Successful main-branch integration evidence:

- [Reading workspace checks](https://github.com/justin-napolitano/islam-research/actions/runs/38844624375), including browser interaction coverage, on the integrated application commit.
- [Public container checks](https://github.com/justin-napolitano/islam-research/actions/runs/38844624350) and [owner container checks](https://github.com/justin-napolitano/islam-research/actions/runs/38844624283) on that same commit.
- [PostgreSQL integration workflow](https://github.com/justin-napolitano/islam-research/actions/runs/38844603639) after the backend-bearing notebook/source-pane stack merged. Individual application PR heads also had successful required checks before merging.

Passing CI does not resolve the intermittent local reference-navigation investigation in #138. Synthetic browser and database tests do not demonstrate a real scholarly reading session, cloud sign-in, restore drill, or two-device deployment.

## Closed and superseded issues

| Issues | Decision and evidence |
| --- | --- |
| #125–128 | Completed UI slices: direct navigation, Sources, Questions, and visible linking/edition actions; closed with #129. |
| #130 | Project creation/directory slice; closed with #131. |
| #132 | Retained working tabs and project tree slice; closed with #133. Session retention does not imply automatic crash recovery. |
| [#5](https://github.com/justin-napolitano/islam-research/issues/5) | Completed original programmatic discovery/document-triage tooling. `scripts/literature_search.py`, `scripts/review_document.py`, `methods/programmatic-workflow.md`, and record templates cover its stated deliverables. This does not complete bibliography verification, research, or hosted jobs. |
| [#9](https://github.com/justin-napolitano/islam-research/issues/9) | Closed as superseded/not planned. Its historical local-only architecture is replaced by technical roadmap #30 and product roadmap #84; unfinished pilot research remains open. |

Already closed issues were not reopened merely because their broader epics remain unfinished. Feature slices and parent acceptance have different scopes.

## What remains open and why

All open issue bodies were reviewed against their acceptance scope. These groups organize existing tickets; they are not additional duplicate epics or claims that every item is equally urgent.

| Issues | Remaining outcome |
| --- | --- |
| #1–4, #6–8, #13, #15 | Verify the starting bibliography, perform scoped research, and complete human review and the real-source pilot. Software completion does not finish these research activities. |
| #19, #21 | Complete provider-specific coverage and credential/runtime verification for Quran Foundation/Quranic Arabic Corpus and Sunnah integrations. Existing adapters are not proof of full provider scope. |
| #30, #84–92 | Active technical/product roadmaps and outcome-based epics. They remain open across partial implementation slices. |
| #31, #33, #39, #41, #42 | Configure and verify the hosted service, real owner identity, scheduled cloud jobs, explicit public projection, cross-device use, and backup/restore/release evidence. Local adapters and container tests do not satisfy live gates. |
| #32, #34, #36–38 | Extend the implemented PostgreSQL/semantic/search/ranking/traversal foundations to their full contracts, including later context models and service workflows. |
| #35, #43, #45, #51, #93, #94, #99 | Finish reading, resume, annotation, comparison, and usability acceptance beyond the shipped interaction slices. Examples include two-session verification, automatic unfinished-writing recovery, complete annotation lifecycle, and comparison-pane authoring. |
| #44, #46–48, #50, #53, #55–58 | Complete lexicon identity operations, contextual/history maps, complexity explanations, scholarly article/review workflows, Wikimedia integration, and reviewable agent proposals. Foundations do not substitute for sourced historical content or editorial review. |
| #40, #52, #54 | Complete revision-aware Obsidian synchronization, a full archive restore round trip, and the maintainable open-source release baseline, including the explicit licensing decision. |
| #95–98, #103 | Finish notebook organization and portable projections, attribution/reclassification rules, explained links, changing understanding, and consistently visible inspection basis. |
| #100–102, #104 | Complete supported URL/identifier/file intake, reusable work/edition identity across projects, capture reconciliation, and bounded field-specific locator demonstrations. |
| #134–141 | Immediate recovery/save-state/memory/navigation hardening, followed by optional folders, a useful project home, and explained graph neighborhoods. |
| [#143](https://github.com/justin-napolitano/islam-research/issues/143) | Newly identified gap: rename, archive, and restore projects while preserving references and private work. Creation (#130) and folders (#139) did not cover project lifecycle. |

No additional duplicate tickets were created for deployment, full sync, source intake, or cross-project identity: #31/#42, #40/#54, #100/#102, and #101 already cover them.

## Next delivery order

1. Finish #135 automatic private draft recovery and #136 honest save/unfinished-work state. Confirmed notes and recovery copies must remain distinguishable.
2. Finish #137 bounded mounted-tab memory with safe dirty-work handling. Investigate #138 independently without weakening exact-anchor, conflict, or privacy assertions.
3. Demonstrate the actual source → read → annotate → follow evidence → resume loop under #15/#85, with honest limits on what sources were inspected. Complete the hosted release evidence under #31/#33/#42 before calling it available across machines.
4. Add #139/#140/#143 organization and #141 explained graph exploration in bounded slices; retain #101 for cross-project identity work.

The focused checklist is [second-brain-roadmap.md](second-brain-roadmap.md) and [#134](https://github.com/justin-napolitano/islam-research/issues/134). Its previous pre-merge wording has been updated to reflect the owner's decision to merge the existing stack first. Those follow-ups remain open.

No cloud provisioning, deployment, credential changes, private publication, or new scholarly approval occurred during this reconciliation. `graph/research.ttl` remains the curated graph authority under the existing migration rules; private owner notes and working questions are not automatically promoted into it.
