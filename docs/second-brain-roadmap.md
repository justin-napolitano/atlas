# Qur’an-first product roadmap

The product is a research library with a reader and connected Markdown notebook. The next useful experience is **open the Qur’an → choose surah/ayah → read continuously → write or inspect commentary → resume**. Open Library, Gutenberg and arXiv remain the wider catalog goal; they come after this reading loop works.

This issue is the authoritative product roadmap. #30 remains the technical/hosting umbrella. Roadmap labels indicate order, not completion. The earlier hardening checklist #134 is superseded by this reconciled plan.

## Already merged

The owner-approved stack #148 → #150 → #151 → #152 → #153 → #155 → #157 → #159 → #161 → #163 → #167 → #171 is merged into main. It supplies private recovery, save state, bounded warm tabs, reversible Trash, free margin writing, Markdown/highlight navigation, working appearance controls, document-first notes, and the compact notebook explorer. #149 was already merged separately.

Completed bounded slices: #135/#136/#137/#145/#154/#156/#158/#160/#162/#165. This is software integration, not deployment, scholarly review, a complete Qur’an corpus, arbitrary nested folders, or Obsidian sync.

Integration evidence: final application merge 21390a9 passed main browser/public-container/owner-container checks; final backend-bearing integration aa6cda3 passed PostgreSQL 17/18 contracts. PR heads had passing checks before merge. The newer nightly public snapshot on main was preserved.

## Build order and demonstration gates

| Order | Work | Done when |
| --- | --- | --- |
| 1 | **#172: actual reading resources**, under #19/#45 | An identified permitted Arabic text and named translation supply a complete supported surah, with resource/version/coverage recorded. Two pilot verses are insufficient. |
| 2 | **#173: continuous Qur’an reader** | Open a surah or direct ayah link, read comfortably, navigate, change presentation/resource choices, and resume. No mandatory import wizard. |
| 3 | **#174 + #164: seamless notes and context** | Write free notes or exact annotations, inspect actual attributed commentary in one sidebar, then find a note and return to its same verse/resource. First-note source association happens safely behind the scenes. |
| 4 | **#146: real reading session and fixes** | The owner actually reads for about 30 minutes. Record and fix blocked navigation, lost writing or readability friction before expanding. Fixture tests do not complete this gate. |
| 5 | **#31/#33/#42/#52: usable hosted release** | One-owner PostgreSQL/IAP authoring works from two machines, notes/progress survive, backup/restore is demonstrated, and anonymous visitors see only explicitly published read-only material. Source/resource and open-source release requirements remain explicit. |
| 6 | **#168/#170/#169/#166: broader open catalog** | One search → open → read → note flow spans supported Gutenberg texts, Open Library discovery/availability, then versioned papers. Reading does not require importing every catalog result into a project. |

Proposed English starting preference: Mustafa Khattab’s The Clear Quran; Saheeh International for comparison where supported. Neither is a universally authoritative English standard. #172 must verify resource access/terms and record exact attribution. Morphology in #19 is not a prerequisite for basic reading. Public text coverage never implies full scholarly commentary/research coverage.

## Organization and reusable reading patterns

#139 custom folders, #140 project home and #143 project lifecycle follow observed reading needs; the compact explorer currently shows existing project/collection views. Do not claim those views implement arbitrary nested storage folders.

Reuse a few composable structures as actual texts require them: numbered units now, chapter/section prose next, fixed pages when PDFs/scans arrive, and line/stanza locators when needed. #92/#104 validate later domain extensions; avoid a speculative universal plugin system.

## Later

Advanced ranking #36; complexity/background/history/concordances #46/#55–58; expanded agent proposals/automation #53/#90; full bidirectional Obsidian sync #40; complete portable archive restore #54; elaborate graph exploration #141. Basic source attribution, useful evidence links and Markdown export remain core. Existing features and deterministic harvesting are preserved.

## Research and release boundaries

#15 remains the actual scholarly pilot, with #13/#50 editorial standards and explicit review scope. Coding or displaying a source does not mean its full argument was read or reviewed. #85–92 remain broader epics where acceptance extends beyond merged software slices.

Keep stable IDs, exact quotation/resource anchors, personal notes versus attributed findings, owner-only writes, private defaults and explicit public publication. A translation switch must not move a highlight to different wording. The local preview still saves on this Mac; merged code and synthetic cross-session tests do not establish a hosted synchronized service. This reconciliation covers integration and planning only; the owner requested a roadmap explanation before further feature implementation.

Repository plan: [second-brain roadmap](https://github.com/justin-napolitano/islam-research/blob/main/docs/second-brain-roadmap.md). Reading design: [Qur’an first](https://github.com/justin-napolitano/islam-research/blob/main/docs/quran-first-reading.md). Catalog contract: [seamless open catalog](https://github.com/justin-napolitano/islam-research/blob/main/docs/seamless-open-catalog.md).
