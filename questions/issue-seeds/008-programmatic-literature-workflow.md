## Goal

Use reproducible, inspectable programs for literature discovery and document triage alongside human reading and interpretation.

## Initial implementation

- Query OpenAlex and Crossref with explicit search phrases and retrieval dates.
- Save provider-ranked metadata locally, deduplicated by DOI when possible.
- Preserve OpenAlex Work IDs and citation-count snapshots as discovery context, never as a quality score.
- Extract selectable text from local PDF files using macOS PDFKit and parse common text/DOCX formats without a model or upload.
- Produce deterministic reports with metadata and locator hints, then have a person inspect the original document.
- Track query, inclusion criteria, exclusions, extraction limitations, and evidence in the graph.

## Limits

Automated metadata search does not establish relevance or truth. Text extraction can lose page layout, tables, footnotes, and scan content. No automated report counts as a source review until the original is checked and claims are located and attributed.

## Completion criteria

- Commands and output formats are documented.
- Search outputs preserve query, provider order, IDs, and retrieval dates.
- Full-text downloads remain under local lawful-use controls; no bulk copying into GitHub.
- The source and evidence templates carry records into the graph.
