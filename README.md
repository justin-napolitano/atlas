# Islam research graph

A long-term, literature-backed inquiry into Islam, Islamic thought and practice, and the researcher's own beliefs. The goal is a navigable graph of sources, claims, interpretations, questions, and testable hypotheses whose links remain traceable to evidence.

The research should understand traditions in context before evaluating them. “Islam” spans diverse texts, histories, communities, practices, legal and theological schools, and modern settings. No single source or school stands for all of it. The project can study metaphysical questions while distinguishing them from historical or empirical ones that evidence can test.

## Start here

- [Persistent local workspace](docs/local-postgres-workspace.md) — real PostgreSQL-backed reading and writing on this Mac; startup, local sign-in, durability checks and the explicit limits of legacy-data import.
- [Electron desktop](docs/electron-desktop.md) — configured local Mac app, native lifecycle and verification; [portable offline storage and sync plan](docs/desktop-offline-sync.md).

- [Connected research workspace](docs/connected-research-vision.md) — latest owner-approved direction: one private workspace, effortless loose-note capture, optional collections and meaningful connections; epic #201.

- `docs/reading-desk-checkpoint.md` — the dependable reading-desk slices and an actual owner reading-session checklist; deployment/research gates remain explicit.

- `docs/second-brain-roadmap.md` — Now / Next / Later: reliable reading and writing first, simple organization next, advanced research features later.
- `docs/merge-issue-reconciliation.md` — merged workspace scope, integration checks, backlog closures, and unfinished research/release gates.
- `docs/reader-first-workspace.md` — the Reader A interface connected to saved readings, margin notes, comparison, notebook, search, and sourced agent briefs.
- `docs/design/library-shelf-brief.md` — agreed compact shared library, direct book opening, reference examples and per-book notebook layout; planning only, epic #194.
- `docs/features/library-shelf-contract.md` — planned shelf/discovery/note/save/accessibility acceptance and the #101 identity migration gate.
- `docs/features/gutenberg-direct-reading.md` — Gutenberg catalog search, direct plain-text reading, located private notes and revision-safe resume; Open Library remains planned.
- `docs/quran-first-reading.md` — current priority: continuous Qur’an reading, translation, commentary and durable notes; reusable reading patterns follow real texts.
- `docs/features/quran-reading-progress.md` — private, reversible ayah read marks, surah/work completion and revision-safe saves, separate from reading place and scholarly review.
- `docs/quran-reader-candidate.md` — local Qur’an reader candidate, source/version and rights record, verification, and owner review gates.
- `docs/seamless-open-catalog.md` — planned unified open catalog, direct reading, and durable notes without a mandatory import step.
- [Metadata-first source plan](docs/features/metadata-first-sources.md) — local Electron app next: save references and write connected notes immediately, then add private files and Markdown import; ordered issues #222–225. Hosted web delivery is deferred.
- [Local linked pages](docs/features/local-linked-pages.md) — desktop page nesting, stable Markdown links and backlinks; issue #228 / PR #229.
- [Reader and unified notebook](docs/features/reader-notebook-flow.md) — compact source reading, safe formatted Markdown and one adjacent notebook; epic #231 / PR #235.
- [Local note folders](docs/features/local-note-folders.md) — real folders, inline naming, sidebar drag/drop and keyboard moves; issue #230 / PR #229.
- [Local source intake delivery](docs/features/local-source-delivery.md) — PR #227 implements desktop references, source-linked writing, revision-safe bibliography, bounded Markdown/text imports and database-plus-file restore; actual limits and verification.
- `docs/research-library-vision.md` — library, reader, commentary and portable notes as one product, with a versioned arXiv reading pilot planned.
- `docs/features/document-first-workspace.md` — simplified reader controls, formatted notebook pages, direct editing, and automatic private writing saves.
- `docs/notebook-writing-workspace.md` — independent project notebooks, a dedicated writing view, searchable explained connections, revision-aware saves, and Markdown export.
- `docs/fluid-notebook-reading.md` — sources beside the notebook, exact quote insertion, contained citation navigation, and separate writing/reading-note views.
- `docs/research-destinations.md` — direct Sources/Questions/Notes navigation, complete reference records, typed working questions, and fewer nested menus.
- `docs/project-directories.md` — simple project navigation and durable inline creation.
- `docs/working-tabs.md` — project tree, contextual reading tools, and session tabs that retain open writing and reading position.
- `docs/unified-owner-search.md` — owner-only literal retrieval across the current research authorities and actual saved-reading library.
- `docs/research-tools.md` — source-linked research briefs, notebook saves, and explicit agent exports.

- `docs/reader-ui-samples.md` — three locally runnable reader interface studies: focused reading, linked commentary, and a source-linked notebook; isolated from hosted authoring.
- `AGENTS.md` — research and graph standards.
- `sources/original/starting-reading-list.xlsx` — preserved starting workbook.
- `data/reading-list.csv` — row-level export of the workbook's Reading List sheet.
- `data/starting-framework.csv` — row-level export of its Framework sheet.
- `data/initial-framework.csv` — enriched working transcription; these are the researcher's provisional positions, not established conclusions.
- `hypotheses/initial-hypotheses.csv` — three initial, bounded questions framed as hypotheses to assess.
- `hypotheses/README.md` — how to formulate and evaluate hypotheses.
- `graph/schema.md` — node and edge model.
- `graph/research.ttl` — canonical RDF graph using SKOS and PROV-O.
- `reports/pilot-ulul-amr-quran-4-59.md` — first bounded, source-linked interpretation comparison; the graph carries its attributed claim and evidence records.
- `reports/pilot-ulul-amr-review-proposal-2026-10-18.md` — newly inspected section-level Q 4:59 source notes proposed for human editorial review; no graph promotion.
- `islam-research visualize` — creates an offline interactive radial view of the graph, with search, type filters, and connection highlighting.
- `web/` — lightweight React public research atlas for the curated graph and a deliberately separate, sanitized set of unreviewed discovery leads; deployable as static output on Vercel.
- `graph/shapes.ttl` — SHACL validation constraints.
- `templates/` — reusable source, claim, evidence, concept, hypothesis, and AIF-style argument templates.
- `methods/programmatic-workflow.md` — repeatable literature search and local document triage.
- `methods/research-workbench.md` — unified CLI for saved search plans, screening, document intake, passage annotations, graph validation, and reports.
- `docs/adr/0001-research-platform-standards.md` — standards and storage decisions before expanding the tooling.
- `docs/adr/0002-hosted-research-and-ossie.md` — accepted hosted-workspace architecture, Apache Ossie semantic contracts, configurable rankings, typed graph traversals, and revision-aware Obsidian integration; implementation pending.
- `research-plans/revelation-prophetic-authority.json` — first versioned multi-query research plan.
- `research-plans/background-question-seeds.json` — 48 paced queries across eight broad research questions for repeatable literature harvesting.
- `src/islam_research/` — modular local workflow CLI; `scripts/research.py` runs it directly from a checkout.
- `scripts/literature_search.py` — query OpenAlex, Crossref, Semantic Scholar, OpenAIRE, DataCite, and CORE; deduplicate metadata and save a local JSONL snapshot.
- `scripts/source_search.py` and `scripts/source_fetch.py` — search local OpenITI/QAC/Fihrist/IIIF data, resolve Corpus Coranicum references, and fetch exact Qur'an/hadith references when credentials are configured.
- `src/islam_research/net.py` — sequential per-host request pacing persisted across runs, with a default two-second cooldown and bounded retry/backoff.
- `scripts/review_document.py` — extract text from PDF, DOCX, Markdown, TXT, HTML, or CSV and produce a deterministic review aid.
- `methods/source-evaluation.md` — source evaluation and note-taking method.
- `semantic/` — pinned Apache Ossie interchange metadata, explicit research mappings, and offline-validated ranking/traversal definitions; execution is a separate backend responsibility.
- `docs/owner-api.md` — signed single-owner API, separate read-only publication mode, failure/privacy contracts, and remaining deployment prerequisites.
- `docs/research-operations.md` — executable typed evidence trails, non-AI local graph exploration, and transparent owner-observation scoring with unknown inputs preserved.
- `docs/research-search.md` — bounded, signed-owner lexical retrieval across research records and explicitly selected private notes, with channel/revision provenance.
- `docs/reading-workspace.md` — resizable owner reading UI, revision-aware notes and reading decisions, evidence trails, Markdown export, browser verification, and hosting prerequisites.
- `docs/reading-place.md` — private revisioned reading bookmarks with exact document/annotation targets and explicit cross-session conflict handling.
- `docs/reading-context-evidence.md` — independent edition comparison, directed evidence paths, and bounded source-context navigation.
- `docs/connected-reading-release.md` — reading material, recoverable writing, notebook, comparison and evidence navigation with explicit scope limits.
- `docs/obsidian-notes.md` — shared versioned private Markdown notes and explicit revision-aware Obsidian/file pull/push; no daemon or live cloud authentication is presumed.
- `docs/passage-capture.md` — private immutable source excerpts and W3C passage anchors with Unicode positions, edition/locator checks, revision history, and changed-source diagnostics.
- `docs/passage-marks.md` — revisioned private highlight/underline presentation on those exact passage anchors; no review or publication promotion.
- `docs/reader-margin-workflow.md` — persistent source marks, overlapping selections, adjacent notes, resizable/collapsible margins, exact source links, retry/conflict handling, and remaining resume/pilot verification work.
- `docs/quran-reference-capture.md` — offline Qur’an reference candidates, private revisioned owner decisions, exact source provenance, reverse verse lookup, and reader controls; commentary and translation reading remain separate work.
- `docs/scoped-concept-lexicon.md` — private scoped lexical entries, source-grounded term occurrences, attributed definitions, revision history, and bounded owner API retrieval; public lexical projection remains pending.
- `docs/lexicon-reader.md` — owner reading controls for concept connections, attributed definitions, source reopening, draft/conflict recovery, private history, and lexical search; public lexical projection remains pending.
- `docs/source-intake-workflow.md` — reviewed manual bibliography/URL/identifier intake, explicit existing-source reuse, optional permitted located excerpts, and atomic retry receipts; provider resolution and file import remain pending.
- `docs/passage-verse-links.md` — scoped owner discussion/interpretation links from exact saved passages to verse ranges, pending review with source-bound save verification and retained retries.
- `docs/located-reading-collection.md` — real, located Q 4:59 / 4:83 Rodwell, al-Tabari, and translated Al-Mizan readings, with exact quotation/analyst-paraphrase separation and explicit evidence/reuse limits.
- `docs/postgres.md` — migration-managed PostgreSQL records, retained RDF imports, revision-safe personal state, and real-database test commands; hosted authentication/deployment remain separate slices.
- `docs/postgres-observability.md` — PostgreSQL 17/18 contract matrix and real native log checks for private bound values, error paths, and shared redaction settings.
- `docs/runtime-sql-permissions.md` — previewable post-migration grants, restricted owner/publisher logins, and real PostgreSQL permission tests.
- `docs/publication.md` — owner publication screen, sealed previews, explicit visibility approval, revisioned publication heads, and withdrawal; public image deployment remains pending.
- `docs/public-release-export.md` — restricted-publisher approved export, public-only Ossie metadata, immutable bundles and independent offline verification; public image integration remains pending.
- `docs/public-viewer.md` — approved-bundle public navigation, reloadable project/record links, citations/review limits and withdrawal states; isolated public image/deployment remains pending.
- `docs/public-site-build.md` — isolated public-only frontend/artifact build, independent verification and standalone read-only runtime; container/GCP deployment remains pending.
- `docs/public-container-delivery.md` — approved-only image context, pinned base/scanner, hardened Linux container checks/SBOM and optional default-disabled Cloud Run service; live rollout remains pending.
- `docs/hosted-release-evidence.md` — combined application/infrastructure verification and the unchanged Q 4:59 launch requirements; no deployed release is claimed.
- `infra/gcp/` — reviewable private GCP/PostgreSQL foundation, pinned tooling, credential-free plan tests, and cost/recovery worksheet; no resources provisioned.
- `docs/adr/0003-immutable-public-delivery.md` — approved snapshots in immutable public builds, isolated publisher reads, and a public runtime with no data credentials; deployment gates remain explicit.
- `methods/corpus-scope.md` — Islam-first source selection and bounded expansion into philosophy/religion.
- `methods/editorial-review.md` — source/passage/claim review, uncertainty, publication, and corrections.
- `research-plans/corpora/islam-authority-pilot.json` — existing source IDs and located evidence for the first Q 4:59 reading pilot; not a new review of those sources.
- `templates/editorial-review.md` — concise evidence record for an editorial decision.
- `questions/open-questions.md` — initial question map.

## Initial scope

The workbook begins with God/Being, revelation, prophecy, religious authority, pluralism, ethics, responsibility, and justice. It combines Islamic primary texts and Muslim thinkers with philosophy, comparative religion, and literature. Retain that comparative frame while adding historical and internal diversity across Islamic traditions. Separate the researcher's initial hypotheses from what sources establish.

## Repository layout

`sources/` stores bibliographic records and the original seed file. `notes/` contains source notes. `claims/` records source-attributed propositions and interpretations. `hypotheses/` tracks the researcher's claims and ways they could be challenged. `questions/` holds the inquiry map. `graph/` contains schema and linked machine-readable data. `methods/` documents standards and research methods. `data/` contains structured indexes and imports.

## First pass

1. Review the exported reading list and mark inaccurate or incomplete bibliographic records for verification.
2. Choose a bounded first question, such as what different Qur'anic passages say about revelation and human responsibility, and how classical and modern interpreters read them.
3. Read the primary text in a named translation alongside scholarly commentary and an informed range of Muslim interpretations.
4. Create source notes with precise locations, then add atomic claims and competing interpretations to the graph.
5. Revise the initial framework only through dated, evidenced changes; preserve the history of the researcher's thinking.

## Reimport the workbook

Run `python3 scripts/import_reading_list.py [workbook.xlsx]`. Without an argument, the script uses the original workbook under `sources/original/`. It uses only Python's standard library and rewrites the two CSV exports.

The imported list has 36 entries. Its titles, editions, translators, and links have not been independently verified. Treat every row as a lead until checked against a catalog, publisher, primary text, or scholarly reference. The seed workbook includes substantial comparative philosophy and literature alongside Islamic material; use those comparisons to sharpen questions while keeping the historical study of Islamic traditions independently grounded.

## Graph interoperability and source discovery

The graph uses RDF/Turtle with SKOS concept schemes and PROV-O derivation/attribution. Argument maps follow AIF's distinction between information nodes and scheme application nodes; `templates/argument-network.csv` is a local entry template pending a mapper to a specific AIF RDF reification. SHACL constraints are in `graph/shapes.ttl`. OpenAlex can help discover scholarly works, authors, and topics. Record its Work ID and a dated citation-count snapshot when useful. Counts depend on coverage, language, discipline, work type, and time; they do not measure truth, quality, or representativeness. Evaluate primary sources, editions/translations, specialist scholarship, relevance, and counter-perspectives separately.

## Issue tracker

Use GitHub Issues to track research questions, source reviews, and hypotheses. Forms in `.github/ISSUE_TEMPLATE/` collect scope, evidence, alternatives, and limitations. Issues are an intake and discussion layer; verified, located claims and provenance belong in the repository graph and source notes. Keep private account data and copyrighted source text out of issues.

## Programmatic research tools

Run `python3 scripts/literature_search.py "Qur'an revelation prophetic authority" --provider both --limit 20` for OpenAlex and Crossref metadata discovery. Results are saved under git-ignored `research-library/searches/`; no abstracts or PDFs are downloaded. Run `python3 scripts/review_document.py /path/to/article.pdf` to extract a local document and create a review checklist. PDF extraction uses Apple's PDFKit through the included Swift helper; it extracts selectable text and does not OCR scanned pages. Saved plans rotate provider order across queries, and network requests share a persistent per-host cooldown. See `methods/programmatic-workflow.md` and `methods/research-workbench.md` for limits, source-specific setup, and review steps.

For the unified flow, install the optional RDF tooling with `python3 -m pip install -e '.[graph]'`, then run `islam-research search research-plans/revelation-prophetic-authority.json`, `islam-research candidates RUN_ID`, `islam-research intake /path/to/document.pdf`, `islam-research annotate --help`, `islam-research validate`, `islam-research export`, or `islam-research report initial-authority-question`. Search, screening, local intake, and annotation are available without the optional graph dependencies. See `methods/research-workbench.md`.

For the public React research studio, see `web/README.md`. Its GitHub Actions workflow harvests the seed plan daily, builds a sanitized static snapshot, and commits changed public data to `main`; a Git-connected Vercel project deploys that commit. Local preview uses `cd web && npm install && npm run dev`. Unreviewed search candidates remain separate from the curated RDF graph.

The owner reading workspace now connects [source intake, the bounded article preset, and the attributed Qur’an pilot](docs/reader-library-integration.md) to exact reading documents and margin annotations. These private workflows require the corresponding owner API migrations and authentication; the anonymous public artifact remains selected read-only research.

The authenticated owner runtime, isolated build, native-IAP/private-SQL delivery configuration and remaining live rollout gates are documented in [owner service delivery](docs/owner-service-delivery.md).

The [linked reading workflow](docs/linked-reading-workflow.md) follows saved passage → scoped verse discussion/interpretation → exact source and adds an explicit per-project server bookmark with retry/conflict controls. Unsaved notes and scrolling are not synchronized by the bookmark.

The [private research notebook](docs/research-notebook.md) collects running thoughts and live passage/record notes with exact source anchors, explained connections and revision history.
[Recoverable private writing drafts](docs/recoverable-writing-drafts.md) preserve explicitly saved unfinished record/passage notes across sessions, with exact source anchors, historical baselines, conflict comparison and recoverable discard. Recovery fills the editor; it does not automatically commit notes or publish content.

The [shared library identity foundation](docs/features/shared-library-identities.md) adds owner-only book identities and cross-project references while preserving existing notes and source links. Shelf and discovery UI remain subsequent work.

The [shared personal library shelf](docs/features/library-shelf.md) adds saved-book navigation, selected-edition reading, original-note links and project associations within the existing sidebar.


The connected owner workspace is implemented in #207–211: one sidebar, independent
body-first Markdown capture, global reading/notes/questions, optional collections and
saved views, explained connections and dated reasons. Start with the
[delivery/use guide](docs/features/connected-workspace-delivery.md), the
[product roadmap](docs/second-brain-roadmap.md) and the
[interaction contracts](docs/features/connected-workspace-contract.md).
Hosted owner sign-in, two-device/backup proof and scholarly/owner reading acceptance
remain separate gates; a local review or passing CI does not establish them.
