# Programmatic literature search and document review

The project uses reproducible programs to find records, inspect local documents, and organize review. Programs can filter and report observable metadata. They cannot determine a source's truth, interpret a religious text, or replace specialist judgment.

## Search scholarly records

```sh
python3 scripts/literature_search.py "Qur'an revelation prophetic authority" --provider both --limit 20
python3 scripts/literature_search.py "Ibn Arabi divine being" --provider openalex --limit 30
```

The CLI queries OpenAlex Works, Crossref, Semantic Scholar, OpenAIRE, DataCite, and CORE over HTTPS using only Python's standard library. Search results are deduplicated primarily by DOI, saved as timestamped JSONL under `research-library/searches/`, and include provider rank, source identifiers, title, year, author metadata, venue, OA status/URL when present, and dated citation-count snapshots. Query, retrieval time, and provider rank are retained. A partial provider failure is reported; available results are still saved.

Choose a single provider with `--provider openalex`, `crossref`, `semantic_scholar`, `openaire`, `datacite`, or `core`; `both` remains the OpenAlex + Crossref shortcut. Semantic Scholar and CORE accept optional `SEMANTIC_SCHOLAR_API_KEY` and `CORE_API_KEY` environment variables. `CROSSREF_MAILTO` is also optional. Keep credentials in your shell environment or a private secret manager, never in plans or this repository. CORE may require a key and is subject to service limits. The search plan runner rotates the first provider for each query and runs requests sequentially. Shared networking persists request timestamps in ignored `research-library/runtime/provider-pacing.sqlite3`, applies a two-second default minimum interval per host across separate runs, honors `Retry-After`, and uses bounded retries. `ISLAM_RESEARCH_MIN_INTERVAL` can increase the delay; lower it only if the relevant service terms permit.

The tools do not fetch abstracts, full texts, or PDFs, and do not submit your notes to either provider. Search terms are sent to the public services as query strings. Do not include private notes, tokens, or personal data in a query. Review terms of use and access conditions before retrieving a linked document.

Provider relevance order is an initial candidate list, not a score for quality. OpenAlex citation counts depend on coverage, language, discipline, work type, and date. Do not use raw counts to rank primary scriptures, historical texts, or specialist works. Assess relevance to the question, source role, textual edition/translation, method, scholarly context, perspective coverage, and counterevidence separately. Record exclusions and reasons if doing a formal review.

## Triage a local document

```sh
python3 scripts/review_document.py ~/Downloads/article.pdf
python3 scripts/review_document.py ~/Downloads/chapter.docx
```

Supported inputs are PDF, DOCX, TXT, Markdown, HTML, and CSV. The program extracts text locally; it never uploads, edits, or deletes the source. PDF text extraction uses macOS PDFKit via the included Swift helper and requires selectable text. Scanned pages need OCR and are flagged by empty/short extraction rather than silently treated as reviewed. DOCX extraction uses the standard-library ZIP/XML reader. The output contains extracted text and a deterministic report with word count, page count where available, likely headings, DOI/year candidates, citation markers, and a manual review checklist.

These are search hints, not semantic analysis. Citation regexes have false positives and misses; headings can be misclassified; extracted reading order may be wrong; OCR is not performed. Open the original, verify exact locators, and read surrounding context before entering evidence. The program never claims to have assessed the argument or scholarly quality.

## Data handling and graph entry

All search snapshots, extracted documents, and review aids default to git-ignored `research-library/`. Keep copyrighted full texts there only for personal lawful access. The repository should contain bibliographic metadata, appropriately brief located quotations or paraphrases, and graph records—not downloaded books. Move reviewed metadata into `data/sources.csv`; represent source-attributed claims and evidence in `graph/research.ttl`, following the templates. Preserve the search query and retrieval date so a later search can be compared.

## Islamic text, language, and manuscript sources

The unified CLI has additional non-AI discovery and reference tools:

```sh
islam-research source-search openiti "obey God and obey the Messenger" --path /path/to/OpenITI --limit 30
islam-research source-search qac "verb" --path /path/to/qac-download.txt
islam-research source-search fihrist "Qur'an" --path /path/to/fihrist-tei-export
islam-research source-search iiif "Qur'an" --path /path/to/iiif-manifest-export
islam-research source-search corpus-coranicum 4:59
islam-research source-fetch quran-verse 4:59 --translation 20
islam-research source-fetch sunnah-reference bukhari:1
```

OpenITI, QAC, Fihrist, and IIIF search only files you supply locally. OpenITI scans `.mARkdown` texts and adjacent YAML metadata; QAC scans the supplied annotation file; Fihrist reads TEI XML; IIIF reads Presentation JSON manifests. Results are line-, file-, or reference-level candidates, stored under ignored `research-library/searches/`, and are never accepted as claims. The Corpus Coranicum command resolves a verse to its passage page and does not scrape it. These local scans can use substantial disk I/O on large exports; start with the source's smaller dataset where possible.

Quran Foundation verse retrieval needs a developer app's `QF_CLIENT_ID` and `QF_CLIENT_SECRET`; production is the default (`QF_ENV=production`), while `QF_ENV=prelive` selects its test environment. Optional translation IDs are provider resource IDs. Sunnah.com exact-reference retrieval needs an API key in `SUNNAH_API_KEY`; request access from the provider. Its documented API supports reference lookup here, not general literature-style search. Fetch commands print the provider response for review and do not save full text into the project automatically.

Respect each source's access terms. OpenITI/KITAB corpus text is locally indexed; keep licensed corpus files out of git and retain required attribution/licensing. QAC downloads are separately licensed; cite and follow the download's terms rather than copying its contents into public records. For digitized manuscripts, preserve the catalogue/manifest identifier and rights statement. Source discovery makes leads, not verified editions or interpretations.

Create a candidate-only graph for a run and visualize it separately:

```sh
islam-research candidates RUN_ID
islam-research graph-import RUN_ID
islam-research visualize --graph research-library/imports/RUN_ID-candidates.ttl \
  --output research-library/reports/RUN_ID-wheel.html
```

The Turtle import includes source-candidate metadata and PROV-O harvest provenance; it deliberately creates no claims or links to the curated graph. Review candidates and verify stable IDs, editions, rights, and precise locations before curating records in `graph/research.ttl`.
