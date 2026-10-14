# Programmatic literature search and document review

The project uses reproducible programs to find records, inspect local documents, and organize review. Programs can filter and report observable metadata. They cannot determine a source's truth, interpret a religious text, or replace specialist judgment.

## Search scholarly records

```sh
python3 scripts/literature_search.py "Qur'an revelation prophetic authority" --provider both --limit 20
python3 scripts/literature_search.py "Ibn Arabi divine being" --provider openalex --limit 30
```

The CLI queries OpenAlex Works and Crossref bibliographic metadata over HTTPS using only Python's standard library. Search results are deduplicated primarily by DOI, saved as timestamped JSONL under `research-library/searches/`, and include provider rank, source identifiers, title, year, author metadata, venue, OA status/URL when present, and dated citation-count snapshots. Query, retrieval time, and provider rank are retained. A partial provider failure is reported; the other provider's results can still be saved.

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
