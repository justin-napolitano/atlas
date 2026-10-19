# Unified research workspace: implementation brief

Status: owner-approved direction; implementation planned, not built by this document.
Decision date: 2026-10-18. This brief supersedes older frontend instructions that prescribe a global header, large working tabs, a nested notebook explorer, or permanent Write/Preview controls. Preserve their data contracts and useful capabilities; replace their presentation.

Delivery tracking: [workspace reset #177](https://github.com/justin-napolitano/islam-research/issues/177), with ordered slices [shell and theme #178](https://github.com/justin-napolitano/islam-research/issues/178), [inline Markdown and safe autosave #179](https://github.com/justin-napolitano/islam-research/issues/179), then [reader/context #180](https://github.com/justin-napolitano/islam-research/issues/180). These refine the existing design umbrella #51 and product roadmap #84; they do not replace hosted-release or owner-session verification.

## Product and outcome

A personal academic second brain with three equally real activities: reading sources, writing connected Markdown notes, and developing research questions. Qur’an reading is the first complete reading flow. Sources, annotations, citations, commentary, concepts, research links and personal writing remain connected. Other disciplines and catalogs follow later.

The target is **one left sidebar and one continuous document workspace**, with optional adjacent source/context content. The app should feel like opening a document, not entering another application inside a page.

The owner approved the direction of Bear’s visual restraint, Obsidian’s document organization/live Markdown editing, and Readwise Reader’s contextual annotations. Borrow those specific behaviors, not an entire interface or every feature. References: https://bear.app/ ; https://obsidian.md/ ; https://obsidian.md/help/edit-and-read ; https://readwise.io/read . These are reference points, not dependencies or a claim that those products have identical layouts.

## Evidence and problems to solve

The owner’s supplied screenshots show a global navigation bar, project navigation, a second notebook navigation tree, an oversized tab strip, and a framed notebook panel. Repeated headings and controls compete with writing. Another screenshot shows Write/Preview buttons, word-count instructions and a Thought type dropdown in the writing flow.

Specific rejection: “site within a site,” old web-application styling, multiple menus, large white buttons, repeated dark rectangles, forms around notes, and administrative metadata dominating the document. The owner explicitly permits replacing almost all of that frontend structure. Preserve research data and behavior rather than defending the existing layout.

Do not put screenshots containing personal writing or local research state in this public repository. These descriptions record the design evidence without copying the owner’s content.

## Information architecture: settled decisions

- One persistent left sidebar contains search, a small New action, projects and their content. Account, appearance and a truthful storage/sync indicator sit at its bottom.
- Projects expand in that same sidebar. Sources, Questions and Notes are views/branches inside the project; their items open directly in the main workspace. Do not render another project root or explorer inside Notes.
- A single selected item has one title and one document surface. No global top navigation, permanent top tab strip, duplicate notebook heading, or enclosing document card.
- Recent/open items may occupy a compact sidebar section. Preserve unfinished work and navigation history underneath; removing visible tabs does not authorize deleting the working cache or its draft protections.
- Existing My writing / Reading notes / Everything collections are filters, not physical directories. Simplify or relocate them as secondary filters. Do not misrepresent them as user-created folders. Actual nested folders remain tracked under #139; implement their authority separately when scheduled.
- Graph exploration and research tools remain reachable through project/context actions. They are not default furniture around every note.
- The main content is the selected note, question or reading. Search results temporarily replace that surface; selecting a result opens the actual item with its verified context.

## Reading and writing behavior

### Notes

1. Select a note in the sidebar: immediately see its title and formatted Markdown, with the cursor ready where the user last worked when that state exists.
2. Click or move the cursor into a block: edit there; reveal the necessary Markdown syntax locally. Surrounding content remains formatted.
3. Continue typing: autosave quietly. Show Saving, Saved or a meaningful failure only where useful; Saved must describe the exact confirmed current content.
4. Follow a note/source link: open the linked content within this workspace. Back returns to the prior item and reading/cursor position. Context links must retain their exact source/version tuple.

A textarea with a separate rendered preview is not the desired live-editing experience. Before choosing an editor, verify a maintained implementation can round-trip our existing Markdown, tables, footnotes, code, links and citations without changing the saved source unexpectedly. Prove Arabic/RTL, IME composition, undo/redo, selection, paste and keyboard behavior in a small real component spike. Do not write a new Markdown parser or choose an editor solely because its demo looks good. Package choice remains an implementation decision after that evidence.

Remove permanent Write/Preview buttons, “click text to write” instructions, word counts and Thought type dropdowns from the document. Keep an explicit raw Markdown/source option available as a secondary command. Creating under Questions sets the existing question type; Notes defaults to a note. Classification remains editable in item properties. Never relabel personal writing as reviewed evidence.

New creates a blank note in the active project, or a question when invoked in the Questions branch. Focus the title/body directly. Adding a source is contextual to Sources/search and retains the real intake/rights contract where acquisition is needed; no mandatory import form before ordinary supported reading.

### Reader and source context

- A reading opens as text, with its structural navigation available through the same sidebar and a compact local location control. Qur’an uses surah/ayah; source edition and translation remain explicit.
- Clicking a source link from a note opens a temporary, resizable source pane beside the note, without loading a second app shell, another navigation tree or a second set of global controls.
- Selecting text reveals the relevant annotation action. Clicking a saved highlight opens its note. Free margin writing requires no quote selection.
- Personal notes on an exact quotation, an approximate location, an ayah/range, a surah and a whole work remain distinct. Do not manufacture selectors or move a highlight onto another translation.
- Commentary, citations, backlinks, definitions and provenance appear in relevant context. Keep edition, attribution and exact location reachable; do not repeat long review boilerplate around every paragraph.
- Source comparison is a deliberate temporary split view. The owner can close it and continue in the original document without losing position or writing.

## Layout and typography contract

- Desktop: one sidebar, initially about 240 px, with a practical 200–320 px resize range; one main workspace. A context pane opens only when requested and can be closed without losing work.
- Main workspace uses the available viewport, with a comfortable text measure around 60–75 characters, bounded by the actual content font metrics. Avoid a narrow document stranded inside several padded boxes.
- Sidebar text starts around 13–14 px; note body around 18–20 px; English reading around 22 px. Retain working user font/size/zoom preferences and independent Arabic controls. These starting values must be verified in the real app.
- Note titles are restrained, around 26–30 px, rather than giant editorial headlines. Avoid repeated uppercase eyebrow labels and tiny metadata text.
- Small screens use the same sidebar as a dismissible drawer, not an additional navigation system. Context appears as a usable sheet or focused pane, with an explicit way back and writing preserved. At 390 px, no horizontal page overflow or miniature scaled desktop layout.
- Sticky controls must account for real surrounding layout. Check their visible hit targets after scrolling and text resizing; a control covered by another layer is a failed control even if a DOM click test passes.

## Color contract

Use named semantic tokens consistently, not unrelated colors in each component. The owner approved this starting palette; contrast and full-page appearance must be verified before final acceptance.

| Role | Dark starting value | Use |
| --- | --- | --- |
| Canvas | `#1C1C1C` | Entire main reading/writing background |
| Sidebar | `#181818` | Slightly distinct navigation surface |
| Hover/selection | `#292929` | Neutral item feedback, not a large burgundy card |
| Primary text | `#E6E3DE` | Soft ivory, comfortably legible |
| Secondary text | `#AAA6A0` | Useful metadata, not body text |
| Divider | `#333333` | Sparse separators, not nested frames |
| Accent | `#E27878` | Links, focus, annotation details and small active indicators |

One main background continues behind the document. A context pane shares it, separated by one quiet boundary. No black outer void around an inset gray application. Avoid pink-filled active pills at every hierarchy level, large white buttons, gradients, decorative cards, shadows around ordinary content or unrelated saturated colors. Red is meaningful and sparse. Use text/icons with adequate hit areas; important actions still need discoverable labels and keyboard access.

Keep light mode possible through the same tokens. Do not invert arbitrary source PDFs or independently theme individual sub-apps. Final light colors remain to be chosen and verified; dark is the initial design target.

## Data and interaction invariants

These are requirements, not optional polish:

- Existing project/source/document/note/annotation IDs, edition hashes, Unicode selectors, typed research links, history, Trash and private/public boundaries survive the refactor.
- PostgreSQL and existing owner-authorized APIs remain application authorities. The local preview remains visibly local; its JSON adapter is not proof of hosted sync.
- Preserve frozen creation UUID/payload retries, CAS conflict handling, newer typing during in-flight saves and durable recovery. Never overwrite the latest draft with an older acknowledgement.
- Emptying a saved note must not silently save an older queued body or show a misleading Saved state. Distinguish an empty draft from an explicit Trash operation.
- Navigating, hiding a pane, changing projects or suspending a component must preserve unfinished writing. Draft ownership belongs outside disposable view components.
- Removing a visible tab must not make dirty state unreachable. Expose pending/conflicted work in the sidebar or a clear status surface.
- Persist presentation preferences separately from private research content. No new browser-storage authority for notes.
- “Local · this Mac” can replace the large yellow demo banner and its duplicate navigation, but its explanation must still disclose that hosted sign-in/sync are absent. Show Synced only after real verified acknowledgement in the configured hosted runtime.
- Source review status, agent proposals and publication remain explicit. A cleaner interface never implies that the whole work was reviewed or that a private note was published.

## Implementation map and sequence

Read `AGENTS.md`, this brief and `docs/features/quran-continuous-reader.md` first. Inspect the current code before editing; this map describes responsibilities, not immutable filenames.

| Existing area | Responsibility in the redesign |
| --- | --- |
| `web/src/workspace.jsx`, `ProjectDirectories.jsx` | One application shell/sidebar, project and selected-item navigation |
| `ResearchNotebook.jsx`, `researchNotebook.css` | Extract the document editor from its nested explorer and administrative chrome |
| `WorkingSurfaces.jsx`, `workingCache.js`, `surfaceActivity.js` | Retain protected drafts/resume while replacing the visible tab strip |
| `NotebookSourcePane.jsx`, `SourceReader.jsx`, `QuranReader.jsx` | Contextual reading without another shell; preserve source/version navigation |
| `NotebookMarkdown.jsx`, notebook Markdown/citation helpers | Preserve rendering, linking, citations and source round-trip contracts |
| `notebookClient.js`, `marginWriter.js`, `recoveryQueue.js`, `useWritingRecovery.js`, `passageNoteEditor.js` | Reuse save/retry/conflict authorities rather than bypassing them |
| `atlasWorkspace.css`, `workspace.css`, `researchNotebook.css`, reader styles | Consolidate token/layout ownership; replace obsolete rules rather than adding more override layers |

1. **Shell and navigation.** Inventory all existing actions and give each a destination: sidebar, document, context, properties, or settings. Unify the tree, remove duplicate chrome and apply the color tokens. Keep the existing editor working while this is reviewed.
2. **Document editing.** Prove the live Markdown editor on existing data and difficult scripts/content. Integrate autosave/recovery and then remove mode buttons and form controls. Question/type properties remain available outside writing.
3. **Reader/context integration.** Make source links, highlights, commentary, backlinks, comparisons and return navigation fit the one-shell design. Verify full Qur’an reading and source-version isolation.

Commit small working slices and open/update PRs as work proceeds, as previously requested. Do not merge a visual reset solely on screenshot resemblance. Do not create a parallel decorative prototype with fake saves as a substitute for integrating the real workspace.

## First-pass acceptance script

Use synthetic research content for automated tests; never read or print `research-library/local-preview/state.json`. Observe the real local app separately without modifying the owner’s writing.

1. Open the app at 1440 px and 390 px. Exactly one navigation tree is visible; no header navigation, nested notebook tree or permanent tab strip. Verify a keyboard user can search and open an item, collapse the sidebar, and return focus.
2. Open an existing note. Its ID, text, links and classification are unchanged. Edit inline, paste Markdown containing a table, footnote, code, citation and mixed English/Arabic; save and reopen without source corruption or unintended review changes.
3. Make a new note and a question from their respective branches. Confirm each real server type and project, and make both reachable through the single sidebar and search.
4. Hold a save response, continue typing, then release it. The new words survive. Simulate a lost acknowledgement, retry the original request, and confirm one note. Simulate a real competing revision; both versions remain available and no automatic overwrite occurs.
5. Navigate between notes/projects while writing, close a context pane, and trigger cache suspension. Return to the intact draft. Verify recovery after a new session using the actual persistence contract; distinguish synthetic evidence from hosted proof.
6. Open Q 4:59, change font size/zoom, scroll, write a free note and annotate a selected phrase. The source text stays unchanged. Verify Arabic/English resource isolation, canonical resume and legacy pilot IDs.
7. Follow a passage link from a note. Show the original edition and exact location beside the note; return without a whole-page detour or loss of scroll/cursor. Confirm source/range/surah/work note scopes remain distinct.
8. Check empty, loading, offline, expired-sign-in, conflict, Trash/restore and unavailable-source states. No fake cloud-success indicator, misleading first-note empty state when notes exist, or hidden data loss.
9. Inspect the actual assembled app in dark mode, not only isolated components: no inset app frames, bright white action blocks, redundant headings or covered controls. Check text/focus contrast and readable sizes, keyboard focus, screen-reader labels, RTL and reduced motion where applicable.
10. Run relevant frontend/unit/browser checks and production build. If backend contracts change, run real PostgreSQL 17/18 tests and owner/public boundary checks. Existing tests should validate real behaviors; update selectors for changed navigation without weakening save/identity assertions.

Then perform the owner’s real reading/writing session under #146. Hosted multi-device, backup/restore and public-release verification remain #42 and related hosting issues. This frontend reset does not itself complete them.

## Boundaries for this pass

Keep the reader, research relationships and first-class notes. Defer broad catalog expansion, new graph algorithms, agent automation, full Obsidian sync, arbitrary block databases and speculative universal reader frameworks. Do not install or select a new editor until its compatibility spike is evidenced. Do not migrate authoritative research data just to simplify navigation. Do not add more permanent buttons to rescue discoverability; improve placement and context instead.

Success: the owner opens one sidebar item and can read, write, follow evidence and continue without thinking about which sub-application they entered.
