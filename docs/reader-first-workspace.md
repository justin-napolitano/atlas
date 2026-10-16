# Reader-first workspace

The selected Reader A design now wraps the real owner workspace. The source text is the primary surface. A narrow, resizable library lists actual saved editions and excerpts; margin notes sit beside the reading. Search and research briefs are available from the compact header. Comparison, notebook, source intake, the located reading collection, Qur’an material, evidence trails, concepts, citations, and editorial publication retain their existing operations.

## Reading flow

1. Open `/workspace.html` through the configured owner runtime. An explicit source/document/annotation URL wins over startup suggestions. Otherwise the workspace opens the project's explicitly saved reading bookmark, or its first actual saved document. An empty library offers source intake and starting readings instead of fabricated text.
2. Read immediately. Select text to reveal highlight, underline, or margin-note actions. Alt+N remains available. Edition, location, original URL, source notice, and import tools are in expandable details below the text.
3. Save a passage note explicitly. Notes retain their existing Unicode positions, source version/hash, revision, retry, and conflict semantics. Empty, unmarked connection anchors are available under **Linked source passages**; they are not counted as personal writing. **Explore this passage** reveals citation, verse-link, definition, and annotation-export tools.
4. Use **Compare** to open independent saved-source panes and return to the original version. Use **Notebook** to collect questions and other thought types with exact source backlinks. Source-level read/keep/skip decisions and Markdown export remain accessible below the reader.
5. Use **Search your research** or Cmd/Ctrl+K to find current-project source text, records, notes, thoughts, concepts, and definitions. Search query/results stay in page memory when following a result and reopening search. They are not written to browser storage. Notebook search results open the actual saved entry.
6. Use **Agents** to prepare an open question linked to verified source context. Save it as a private notebook question or explicitly export a structured brief for another agent. This screen does not execute a model or schedule a background worker.

The shell and retrieval contract use project/source identifiers and work across research subjects. The existing Islam-specific collection and Qur’an tools remain explicit study tools, rather than assumptions about every document. This change does not add another religious corpus or create historical/interpretive links automatically.

## State and boundaries

Actual writing uses the existing owner-authenticated API and PostgreSQL authorities. Browser storage contains theme and pane-geometry preferences only. Unfinished page-memory edits survive tool navigation; explicit recovery saves and notebook saves provide the existing durable writing paths. Merely navigating to the agent-brief screen does not mark a blank document dirty. Completed briefs do not keep an unsaved-change warning active.

Opening a source, running a search, changing layout, or exporting an agent brief does not publish research, promote review status, or edit canonical RDF. Public viewing remains a separate explicitly approved snapshot. API search results are finding aids, not semantic entailment, consensus, or quality judgments. The private retrieval surface requires review before live rollout; existing deployment and identity gates remain in effect.

## Build and verify

From `web/`, run `npm test`, `npm run build`, `node scripts/review-workspace.mjs`, and `node scripts/review-research-tools.mjs`. The browser reviews use isolated, clearly synthetic adapters and owned Chrome profiles. They do not validate a live hosted identity or database deployment.

The search SQL is checked by `tests/test_research_search.py` against real isolated PostgreSQL in the existing 17/18 CI matrix. Owner transport and public-route isolation are covered by `tests/test_research_search_api.py`. See [unified-owner-search.md](unified-owner-search.md) and [research-tools.md](research-tools.md) for contracts and explicit limitations.

Local design review can use a separately labeled loopback demo adapter. Its local file saves are not evidence of hosted PostgreSQL execution or multi-device synchronization. No GCP resources are provisioned by this interface change.
