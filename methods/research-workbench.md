# Research workbench

The workbench connects candidate discovery, local document processing, human review, and the RDF research graph. Programs produce traceable candidates and reports; the researcher verifies sources, passages, and interpretations.

## Install

Discovery, screening, intake, and annotation use Python's standard library. Graph parsing and SHACL validation need the optional graph dependencies:

```sh
python3 -m pip install -e '.[graph]'
```

For a checkout-only run without installing the package, use `python3 scripts/research.py ...` instead of `islam-research ...`.

## Run a saved search plan

```sh
islam-research search research-plans/revelation-prophetic-authority.json
```

Plans are JSON so they are readable and versionable. Each run receives a unique local directory under git-ignored `research-library/searches/`, with provider/query snapshots and a manifest. The manifest records purpose, filters, status, and failures. Search output is candidate metadata; plan filters do not imply that a provider applied language, tradition, or source-role constraints unless the provider API explicitly did so. Apply those criteria during screening.

Append a human screening decision with a reason:

```sh
islam-research screen 20261014T120000Z-a1b2c3 doi:10.example --decision uncertain --source-role modern_scholarship --relevance medium --tradition-or-scope 'Sunni and Shi i traditions; verify chapter scope' --edition-status unverified --reason 'Relevant title; inspect contents and edition before inclusion.' --reviewer local
```

First build the cross-query queue with `islam-research candidates 20261014T120000Z-a1b2c3`. Candidate IDs come from the deduplicated provider records; the queue retains which queries found each record and provider rank by query.

Screening logs default to `research-library/screening/`. They are local because reviewer identities and private screening notes should not become public accidentally. Curate and anonymize decisions before committing research records.

## Intake a local document

```sh
islam-research intake ~/Downloads/article.pdf
```

The intake manifest includes the original file path, SHA-256 checksum, size, tool, timestamp, extraction status, and review status. Original files, extracted text, and reports stay under ignored `research-library/intake/`. A checksum identifies the input used; it does not grant redistribution rights or guarantee extraction accuracy.

Create a passage annotation only after checking it against the cited source:

```sh
islam-research annotate \
  --source 'https://example.org/edition/page' \
  --locator 'edition identifier, surah:verse or page' \
  --quote 'exact short passage from the representation' \
  --prefix 'optional preceding text' \
  --suffix 'optional following text' \
  --note 'Why this passage is relevant; do not state an unverified interpretation.' \
  --translation 'named translation and edition' \
  --reviewer local
```

The output uses W3C Web Annotation JSON-LD with a `SpecificResource` and `TextQuoteSelector`, plus the project locator and translation fields. It is saved locally by default. Generic quote selectors complement domain locators; they do not replace exact edition, page, verse, hadith, manuscript, or archive citations. The command requires a quote and records that the interpretation still needs review. Store only brief quotations appropriate to the source rights and project use.

## Validate and report

```sh
islam-research validate
islam-research export
islam-research export --check
islam-research visualize --output research-library/reports/research-graph-wheel.html
islam-research report initial-authority-question \
  --output research-library/reports/initial-authority-question.md
```

Validation parses Turtle and runs SHACL. GitHub Actions runs the same validation when graph files change. Export generates CSV node/edge/evidence indexes and JSON-LD from canonical RDF; `--check` detects missing or stale outputs. Exports default to ignored `research-library/exports/` so they cannot silently overwrite the curated CSV inputs. `visualize` creates a self-contained, offline HTML radial graph view with search, type filters, and neighbor highlighting. Reports are generated from canonical RDF and list evidence gaps; they do not determine truth or scholarly consensus. The optional `--graph` argument supports alternate graphs.

## Record states

- `candidate_unreviewed`: provider-discovered metadata, not accepted as a source.
- `machine_extracted_unverified`: extracted text or an automated hint, not checked against the original.
- `human_reviewed`: a named reviewer made a documented decision.
- `needs_followup`: unresolved details or interpretation.
- `researcher_inference`: an analyst-created claim, kept separate from a source's own statement.

Full text, search snapshots, screening logs, and generated reports remain local by default. Public graph records should contain stable bibliographic metadata, brief attributed notes, exact locators, and provenance, subject to rights and privacy review.
