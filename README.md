# Islam research graph

A long-term, literature-backed inquiry into Islam, Islamic thought and practice, and the researcher's own beliefs. The goal is a navigable graph of sources, claims, interpretations, questions, and testable hypotheses whose links remain traceable to evidence.

The research should understand traditions in context before evaluating them. “Islam” spans diverse texts, histories, communities, practices, legal and theological schools, and modern settings. No single source or school stands for all of it. The project can study metaphysical questions while distinguishing them from historical or empirical ones that evidence can test.

## Start here

- `AGENTS.md` — research and graph standards.
- `sources/original/starting-reading-list.xlsx` — preserved starting workbook.
- `data/reading-list.csv` — row-level export of the workbook's Reading List sheet.
- `data/starting-framework.csv` — row-level export of its Framework sheet.
- `data/initial-framework.csv` — enriched working transcription; these are the researcher's provisional positions, not established conclusions.
- `hypotheses/initial-hypotheses.csv` — three initial, bounded questions framed as hypotheses to assess.
- `hypotheses/README.md` — how to formulate and evaluate hypotheses.
- `graph/schema.md` — node and edge model.
- `graph/research.ttl` — canonical RDF graph using SKOS and PROV-O.
- `graph/shapes.ttl` — SHACL validation constraints.
- `templates/` — reusable source, claim, evidence, concept, hypothesis, and AIF-style argument templates.
- `methods/programmatic-workflow.md` — repeatable literature search and local document triage.
- `scripts/literature_search.py` — query OpenAlex and Crossref, deduplicate metadata, save a local JSONL snapshot.
- `scripts/review_document.py` — extract text from PDF, DOCX, Markdown, TXT, HTML, or CSV and produce a deterministic review aid.
- `methods/source-evaluation.md` — source evaluation and note-taking method.
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

Run `python3 scripts/literature_search.py "Qur'an revelation prophetic authority" --provider both --limit 20` for OpenAlex and Crossref metadata discovery. Results are saved under git-ignored `research-library/searches/`; no abstracts or PDFs are downloaded. Run `python3 scripts/review_document.py /path/to/article.pdf` to extract a local document and create a review checklist. PDF extraction uses Apple's PDFKit through the included Swift helper; it extracts selectable text and does not OCR scanned pages. See `methods/programmatic-workflow.md` for limits and review steps.
