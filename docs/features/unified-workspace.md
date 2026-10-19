# Unified reading and writing workspace

Implementation: PR #181, stacked on Qur’an resource/reader PR #176. Delivery issues: #177 (tracking), #178 (shell), #179 (editing), #180 (context). Design and acceptance contract: [unified workspace brief](../design/unified-workspace-brief.md).

## Application behavior

Projects, Sources, Questions, Notes and surah navigation share one left sidebar. The notebook list renders into the shell through `WorkspaceNavigation`; cached inactive documents cannot put another list in that sidebar. The old global navigation and working tab strip are removed. Open work and its pending/conflict state remain reachable in the sidebar, backed by the existing working-surface cache.

The sidebar uses a device-local pixel-width preference, initially 240px and constrained to 200–320px. At mobile widths it is a drawer; pointer opening, keyboard focus containment and Escape return are explicit. Source context is independently resizable with pointer and keyboard controls, with a focused source dialog on mobile. The source pane preserves the note and route, original edition and passage selectors.

Color and shell geometry live in `atlasWorkspace.css`. Catalog/source document styling lives in `researchDestinations.css`; it no longer overrides the application shell. Dark uses charcoal `#1c1c1c`, sidebar `#181818`, ivory `#e6e3de`, secondary `#aaa6a0`, neutral selection `#292929` and restrained red `#e27878`. Existing reading font/size/zoom and explicit page-theme preferences remain independent.

A local preview adapter may set `<meta name="research-storage-mode" content="local-preview">`; this renders “Local · this Mac” with the actual storage/sign-in limitation in the sidebar. This is presentation configuration, not an authorization signal. The production application does not infer cloud synchronization from a successful local write. Existing authenticated APIs remain authoritative.

## Markdown editor decision and contracts

CodeMirror state/view/commands are pinned to 6.7.6 / 6.43.14 / 6.11.1, with no third-party React editor wrapper. The editor is a separate lazy-loaded chunk, so opening the reader does not load it. The active Markdown block remains editable source and surrounding blocks render in place. Raw Markdown is available in Properties. Classification, history, Trash, research connections and graphs remain secondary actions rather than writing-mode controls.

The existing unified/remark parser provides source ranges; existing `NotebookMarkdown` renders them. No Markdown serializer rewrites stored text. GFM tables/tasks, code, footnotes, reference links, wiki links and exact passage citations retain the original source. Reference definitions resolve in referring blocks and reveal as source at the cursor. HTML is inert, unsafe link schemes stay rejected, and remote images require an explicit load. Rendering does not create a new outbound service integration.

The compatibility evidence covers source round-trip, mixed Arabic/English and diacritics, editor undo/redo transactions, browser typing, table/task/code/footnote rendering, live wiki-link resolution, and version-bound quote insertion. Native IME behavior still deserves owner testing on the actual Mac/input method; synthetic text insertion alone does not establish that.

Editor selection and undo state stay in a WeakMap owned by the current in-memory workspace draft map. They never become a second persistent notes database. A first successful create carries cursor/undo state from the provisional key to the assigned durable ID. Server saves, immutable creation UUID/payload retries, CAS conflicts and durable writing recovery continue through existing clients. Source claims and metadata changes retain explicit save/review behavior.

The backend requires a nonempty saved note body. Erasing a notebook body retains an unsaved recoverable draft with a truthful status. Qur’an writing additionally pauses queued writes when emptied, preventing an older queued body from being sent later. An already-sent uncertain request remains frozen for reconciliation; its acknowledgement cannot label the newer empty draft Saved. Trash remains a separate explicit operation.

## Review and verification

Use synthetic fixtures for automated browser checks. Never inspect or export `research-library/local-preview/state.json`, and never publish screenshots of private owner writing.

- `npm test` in `web`: existing save/identity/graph contracts plus Markdown source/undo and empty-draft queue regression tests.
- `npm run build` in `web`: production build, with the live editor loaded separately.
- `node web/scripts/review-notebook.mjs`: real editor integration, lost acknowledgements, newer typing, revision conflict/history, scope/type, Markdown safety, graph/backlinks, contextual source and quote retry, recovery, Trash and mobile widths.
- `node web/scripts/review-quran-reader.mjs`: complete An-Nisa, semantic resume, font sizing, exact highlights, atomic notes, resource isolation and mobile overflow.
- `node web/scripts/review-workspace.mjs`: assembled application, retained reading/writing, actual pointer font control, mobile drawer focus/escape, source/evidence flows and publication/auth boundaries.

Do not rebuild `web/dist` while a preview-based regression run uses it: deleting/replacing hashed assets during a test reload produces misleading failures. Fixture builds use separate temporary output directories.

No backend schema, authentication, publication or deployment changes are part of this reset. New editor dependencies and the rendering boundary require dependency/security review before merge; installation-time npm audit reported no vulnerabilities. Existing CI remains enabled. Owner usability acceptance remains #146; hosted multi-device, backups and release proof remain #42. This change does not close those milestones or implement arbitrary project folders (#139).

## Selected-phrase margin refinement (#182)

Selecting source wording presents “Note on selection” beside the actual selection (Alt+N also activates it). That single action saves the immutable exact capture, opens the corresponding resource/ayah and focuses the phrase note with the quote visible. Generic ayah writing is hidden while working on a selected phrase; “All ayah notes” returns to broader writing. Clicking a saved highlight reopens that exact note. Capture UUID, resource hash and Unicode positions retain the existing retry/verification contract.

The desktop notes divider supports pointer dragging, Left/Right, Home/End and double-click reset. Only its bounded pixel width is stored under `research:quran-notes-width-v1`. Resizing changes geometry rather than remounting the writer and keeps the visible reading position. Narrow viewports retain a bottom notes sheet.

Margin textareas use a caret and contextual quote/mark cues without a rectangular focus box. Navigation, scope, resource and note actions retain compact UI typography independently of reading/notes zoom. Keyboard focus indicators remain on controls and the resize separator. The synthetic reader fixture now includes the full application typography cascade and checks selection-action proximity, actual pointer activation, immutable capture retry, automatic note focus, pointer/keyboard resizing with unfinished text, persisted geometry, borderless editing and control size at high zoom. Owner writing is never used as a test fixture.
# Reading margin simplification (#183)

The reader now uses the same lazy-loaded live Markdown editor as Notes for exact
passage annotations, free-location notes, and ayah/surah/work notes. The active
block reveals Markdown syntax while editing; leaving the editor formats all
blocks. Markdown source remains unchanged and the existing note/annotation save,
revision, conflict and recovery authorities remain in charge. Annotation and
notebook length limits remain 10,000 and 20,000 UTF-16 code units respectively.
Editor cursor/undo sessions are scoped to the workspace draft store and stable
project/note identity, without adding browser persistence for private content.

An exact-passage note opens directly into writing, with its quotation above it.
There is no Done step. Autosave/status and conflict/retry remain visible; mark
style, revision information, Trash and research tools live under Note options.
Private recovery continues while its controls are collapsed and a recovery
failure/conflict appears outside the disclosure.

The margin's context is one compact location/language reference. Its disclosure
retains scope, language, named resource/version, range instructions and passage
tools. Selecting a phrase binds its exact source/version automatically. Clicking
unselected Arabic or English text chooses that verse/resource for subsequent
writing; it never relocates an existing note. Opening Notes after scrolling uses
the tracked reading location. An open margin remains pinned until an explicit
passage/context action, so scrolling cannot silently rebind unfinished writing.

Validation for this slice is in progress; hosted sync, native IME input and owner
reading-session acceptance remain separate from synthetic browser evidence.

