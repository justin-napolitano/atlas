# Academic second-brain priorities

The product combines independent writing and project organization with a source-grounded reading workspace. Personal notes, open questions, source claims, and reviewed scholarship remain distinct and connected through stable identities and exact citations. Islam is the first corpus; future subjects reuse the platform with explicit domain models.

Tracking plan: [#134](https://github.com/justin-napolitano/islam-research/issues/134). This is a focused execution plan under the existing [product roadmap #84](https://github.com/justin-napolitano/islam-research/issues/84), notebook epic #87, and ownership/recovery epic #91. These are planned improvements, not claims that the current app already supplies them.

## Before merging the current production stack

| Order | Issue | Outcome |
| --- | --- | --- |
| 1 | [#135: automatic draft recovery](https://github.com/justin-napolitano/islam-research/issues/135) | Unfinished notes, questions, and supported reading annotations can recover after reload or process loss, with authenticated private storage and explicit revision/conflict handling. |
| 2 | [#136: save state and unfinished work](https://github.com/justin-napolitano/islam-research/issues/136) | Tabs distinguish unsaved, saving, saved, failed, and conflicting work; closed unfinished writing has a direct reopening path. Durable guarantees depend on #135. |
| 3 | [#137: bounded tab memory](https://github.com/justin-napolitano/islam-research/issues/137) | A measured, bounded warm-page cache safely suspends inactive readings. Dirty or pending work cannot be evicted without recovery protection from #135/#136. |
| Independent | [#138: stable reference-navigation verification](https://github.com/justin-napolitano/islam-research/issues/138) | Investigate intermittent local reference-tool timing failures, distinguish harness readiness from application regressions, and retain exact-anchor and draft assertions. Final CI on b07573f passed; stability still needs investigation. |

Keep this batch focused on trust, resource use, and navigation reliability. Do not add automatic scholarly approval, publication, inferred agreement, or reading-completion status. Recovery copies and confirmed saved notes must have separate status. Existing session-only tabs are not crash recovery or cross-device tab sync.

## Next product batch

- [#139: folders within projects](https://github.com/justin-napolitano/islam-research/issues/139): lightweight optional organization; moves preserve identities, references, authoring roles, and visibility. These are application folders, not host directories.
- [#140: project home](https://github.com/justin-napolitano/islam-research/issues/140): continue reading, recent notes, open questions, queued sources, and useful empty-project actions using real bounded queries.
- [#141: explained graph exploration](https://github.com/justin-napolitano/islam-research/issues/141): start from the current item, expand bounded neighborhoods, and explain each connection's direction, evidence, author, and review status. Reuse #97/#37/#101 and provide a readable list alternative.

These follow the pre-merge work; they should not expand the current merge batch. Each issue includes scope, acceptance criteria, validation, and links to the existing epics rather than replacing them.

## Merge and release coordination

The production dependency order at planning time is **#122 → #123 → #124 → #129 → #131 → #133**. Implement the pre-merge fixes in small reviewable changes on top, then validate the integrated head. Retarget dependents as bases merge and verify the resulting main-branch state. Do not delete a base branch before its dependents are safely retargeted.

The design-sample PR **#121** is superseded: review and close it separately rather than merging it automatically. Recording this checklist does not itself merge or close any PR.

Hosted PostgreSQL, owner sign-in, deployment, and cross-device verification remain separate from the loopback review adapter. A local preview is not evidence of a deployed synchronized service.
