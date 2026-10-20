# A readable research library

The product is a research library with a reader and a connected notebook.
The owner's references are Obsidian's simple document navigation and Open Library's
catalog/discovery model. Research, reading, annotation, and commentary remain core;
the notebook is one way of working with the library.

## Immediate priority: the Qur’an

The owner is reading the Qur’an now. Build its continuous surah/ayah reading,
translation, commentary and private-note flow before general catalog integrations.
Use Quran.com as an interaction reference; keep edition-aware resources and
attribution explicit. [quran-first-reading.md](quran-first-reading.md) describes the
flow and small, composable reading patterns for future books. This priority
supersedes the earlier Gutenberg-first delivery order; the unified catalog remains
the broader goal.

## Everyday interface

- **Library:** one shared personal shelf, Continue reading, saved books and direct reader/book-notebook opening. **Find books** opens connected-catalog discovery; reading a supported result requires no prior save. See the [approved shelf brief](design/library-shelf-brief.md) and [contracts](features/library-shelf-contract.md), planned under #194.
- **Reader:** read comfortably; select a passage to annotate, inspect references,
  add commentary, or write a free thought near the current position.
- **Notes:** independent Markdown pages and questions, organized within projects,
  linked back to sources and exact passages when useful.
- **Search:** find sources, notes, concepts and evidence through stable identities.
  Graphs, historical context, advanced ranking and agents support this workflow.

Keep the default interface quiet: folders, titles, the open document, and an optional
notes/context sidebar. Source attribution, review scope, version history, recovery
and publication controls stay accessible. Simplicity must not erase their meaning.

## Seamless catalog before manual intake

Search → open → read → write a note is the default flow. Open Library,
Project Gutenberg, arXiv and later verified open-text providers belong behind
one catalog. No mandatory import or project-add wizard precedes reading.
The first saved note can establish its source/version association automatically;
provider metadata resolution and permitted caching happen behind the scenes.
Manual import remains useful for personal files, blocked sources and unsupported
representations. See [seamless-open-catalog.md](seamless-open-catalog.md) for the
catalog, source identity, annotation and provider contracts.

## Universal intake contract

Support cataloging a paper, book, scripture edition, article, webpage, uploaded file,
or manual reference. An accepted reference does not imply that full text is available
or renderable. Metadata-only sources remain useful and retain an explicit availability
state. Prefer provider identifiers; preserve the distinction between work, edition,
translation, document representation and version. Deduplicate references without
merging genuinely different texts.

Notes can refer to a whole source, a source version, an approximate reading location,
or an exact quotation. Keep personal interpretation, source commentary, scholarly
claims, questions and agent proposals distinct. Sources and passages retain their
provenance, licensing information and original wording. Notes never become public
or scholarly-reviewed merely because an import or agent run completed.

## First general-paper workflow: arXiv

Find a paper in the catalog or paste an arXiv link → resolve its requested version → open a supported
available representation → read and annotate → write a personal review → follow
references → reopen notes at the exact source version.

arXiv's official API supports version-specific identifiers; save that identity rather
than letting later revisions move existing annotations. Its metadata API is one
part of intake, not a complete document-rendering solution.
See the [official API manual](https://github.com/arXiv/arxiv-docs/blob/develop/source/help/api/user-manual.md).

Open Library is a possible book discovery/metadata provider through its
[Search API](https://openlibrary.org/dev/docs/api/search) and
[developer APIs](https://openlibrary.org/developers/api). Book metadata and edition
lookup do not guarantee unrestricted full-text reading. Cache provider responses and
follow their request policies. Sources with unavailable text still belong in the catalog.

## Portable and hosted

Target one authenticated owner with durable PostgreSQL authoring accessible across
machines, plus explicitly published read-only research. Preserve plain Markdown
import/export, stable source IDs, citations and explained links so notes can also
live in an Obsidian vault. Bidirectional sync requires explicit conflict and identity
rules; plugin compatibility is not implied. Obsidian itself is proprietary and is
not the codebase for this project. Open-source release licensing/setup remains #52.

## Delivery and current limits

- #84 is the product roadmap; #88/#100 cover universal source intake; #101 covers
  reusable source identities; #139 covers durable user-defined folders.
- #165 simplifies the existing notebook explorer using project roots and saved
  collection views. It does not implement arbitrary nested notebook folders.
- #164 covers one contextual notes/reference sidebar.
- First make Qur’an reading and notes useful under #45/#19; then expand the same source/note flow into Gutenberg, Open Library and versioned papers. Add structure-specific navigation only when an actual text requires it.
- Current source reading is based on saved bounded excerpts. A compact notebook
  does not constitute full PDF/EPUB/arXiv support. The local preview is local-only;
  hosted identity, database operations, backup and cross-device validation remain
  release work tracked in the existing roadmap.

Keep the implementation sequence in [second-brain-roadmap.md](second-brain-roadmap.md).
