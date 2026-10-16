# Academic second-brain priorities

The product combines independent writing and project organization with a source-grounded reading workspace. Personal notes, open questions, source claims, and reviewed scholarship remain distinct and connected through stable identities and exact citations. Islam is the first corpus; future subjects reuse the platform with explicit domain models.

Tracking plan: [#134](https://github.com/justin-napolitano/islam-research/issues/134). This is a focused execution plan under the existing [product roadmap #84](https://github.com/justin-napolitano/islam-research/issues/84), notebook epic #87, and ownership/recovery epic #91. These are planned improvements, not claims that the current app already supplies them.

## Now: make the core reading loop dependable

The first-release focus is **add a source → read → highlight → write → link → find it again**. Keep exact citations, explicit personal read status, ordinary search, simple source/backlink navigation, and basic Markdown export. This is the owner-approved scope reduction after the merge audit; advanced features remain open for later delivery.

The owner authorized merging the existing stack on 2026-10-16 UTC. The priorities originally identified before merge remain unfinished and come next; integration did not implement them. See the [merge and issue audit](merge-issue-reconciliation.md) for shipped scope, evidence, closures, and remaining gates.

| Order | Issue | Outcome |
| --- | --- | --- |
| 1 | [#135: automatic draft recovery](https://github.com/justin-napolitano/islam-research/issues/135) | Unfinished notes, questions, and supported reading annotations can recover after reload or process loss, with authenticated private storage and explicit revision/conflict handling. |
| 2 | [#136: save state and unfinished work](https://github.com/justin-napolitano/islam-research/issues/136) | Tabs distinguish unsaved, saving, saved, failed, and conflicting work; closed unfinished writing has a direct reopening path. Durable guarantees depend on #135. |
| 3 | [#137: bounded tab memory](https://github.com/justin-napolitano/islam-research/issues/137) | A measured, bounded warm-page cache safely suspends inactive readings. Dirty or pending work cannot be evicted without recovery protection from #135/#136. |
| Independent | [#138: stable reference-navigation verification](https://github.com/justin-napolitano/islam-research/issues/138) | Investigate intermittent local reference-tool timing failures, distinguish harness readiness from application regressions, and retain exact-anchor and draft assertions. Final CI on b07573f passed; stability still needs investigation. |
| After recovery boundaries | [#145: trash, undo, and restore](https://github.com/justin-napolitano/islam-research/issues/145) | Recover private notes and working questions with the same identities and backlinks; preserve concurrent/unfinished writing and keep publication lifecycle separate. |
| Core-flow checkpoint | [#146: real reading session](https://github.com/justin-napolitano/islam-research/issues/146) | Observe the owner researching an actual article for approximately 30 minutes, record friction, fix core blockers, and verify find/reopen/export actions. No claim of completion before the owner performs it. |

Keep this batch focused on trust, resource use, and navigation reliability. Do not add automatic scholarly approval, publication, inferred agreement, or reading-completion status. Recovery copies and confirmed saved notes must have separate status. Existing session-only tabs are not crash recovery or cross-device tab sync.

The actual scholarly pilot #15 and hosted/privacy/recovery release gate #42 remain mandatory. Retain the necessary foundation, identity, licensing, and operational work in #31/#33/#52; reducing feature scope does not remove release prerequisites. Basic Markdown export is not live Obsidian synchronization or a complete portable archive restore (#54).

## Next: simple organization informed by actual use

- [#139: folders within projects](https://github.com/justin-napolitano/islam-research/issues/139): lightweight optional organization; moves preserve identities, references, authoring roles, and visibility. These are application folders, not host directories.
- [#140: project home](https://github.com/justin-napolitano/islam-research/issues/140): continue reading, recent notes, open questions, queued sources, and useful empty-project actions using real bounded queries.

These follow the trust/resource work above. Each issue includes scope, acceptance criteria, validation, and links to the existing epics rather than replacing them. [#143: project lifecycle](https://github.com/justin-napolitano/islam-research/issues/143) adds rename, archive, and restore while preserving identities and references; project creation and folders do not cover this lifecycle.

Findings from #146 take priority over optional organization enhancements when they expose data loss, blocked navigation, or inaccessible core actions.

## Later: outside the first-release milestone

- Advanced ranking profiles (#36) and complexity scoring (#55).
- Expanded historical/context models, concordances, author maps, and before-reading briefings (#46/#56–58). Basic source/author/edition attribution remains core.
- Agent proposal and automation expansion (#53/#90). Existing deterministic discovery and harvesting remain available with their current review boundaries.
- Full bidirectional Obsidian sync (#40). Start with basic Markdown export and preserve stable identities; keep complete archive/restore scope in #54 distinct.
- Elaborate graph exploration (#141). Useful typed links, evidence paths, backlinks, and readable source navigation remain part of the core experience; a new graph visualization is not a launch prerequisite.

These tickets retain their full acceptance criteria and remain open. Existing implemented features are not removed. GitHub labels `roadmap:now`, `roadmap:next`, and `roadmap:later` make this delivery order visible; they do not indicate completion or academic review.

## Merge and release coordination

The production stack merged in dependency order: **#122 → #123 → #124 → #129 → #131 → #133**, followed by planning documentation #142. Dependents were retargeted to main before merging. Main-branch reader and container checks passed on the integrated application commit; PostgreSQL integration also passed for the backend integration. Continue the hardening in small reviewable changes with relevant exact-head checks.

GitHub marked design-sample PR **#121** merged because its commits were already included in #122. It does not require a separate merge or closure.

Hosted PostgreSQL, owner sign-in, deployment, and cross-device verification remain separate from the loopback review adapter. A local preview is not evidence of a deployed synchronized service.
