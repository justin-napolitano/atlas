# Search and sourced research briefs

The reader keeps its advanced tools behind **Search** and **Agents**. Search retrieves saved records, source passages, passage notes, reading notes, notebook thoughts, concepts, and definitions from the current project. Submit a phrase explicitly; typing does not issue requests. Matching is literal and case-insensitive, with exact/prefix titles first. It is not embedding search or a scholarly quality score.

Results keep their exact source, document, annotation, or notebook destination. Filters apply to the bounded response (up to 50 matches). A truncated response calls for a narrower search; an empty filtered response does not establish that the project has no material of that type.

**Agents** prepares a research brief. Write an open question from the current source; a selected saved passage carries its edition, locator, source URL, document hash, and exact annotation after project and anchor checks. Save explicitly to create a private, unreviewed notebook question. A lost acknowledgement retains the same request UUID and locks editing until an exact retry can confirm the saved thought. An untouched brief does not register an unsaved draft. Completed briefs are marked saved.

**Export for an agent** downloads `research-brief.json`: the question, stable context identifiers, a short selected quotation (up to 500 characters), provenance, the saved document’s full source notice when present, a read-only search example, the registered graph/ranking/lexicon operations discovery endpoint, and instructions separating evidence from interpretation. Exporting does not save the question or run an agent. The file contains no session credentials; another client still needs an authorized owner session to call private APIs. No model execution or background agent orchestration is connected to this screen.

Drafts use the workspace's page-memory map; they are retained across tool navigation in the same page, but unsaved questions are not cross-device durable until explicitly saved to the notebook. Public publication and canonical RDF remain separate editorial actions.

Browser verification: `cd web && node scripts/review-research-tools.mjs`. It compiles the actual components with a clearly synthetic API fixture excluded from production build inputs, exercises navigation and retry boundaries, and launches and cleans up its own isolated headless Chrome profile.
