# Document-first reading and writing

Issue #162 follows the owner's feedback that Obsidian feels easier to read.
This pass reduces reader chrome while retaining research operations.

## Reading

Library, Notes, and Appearance are the main reader controls. Actual text size,
notes size, font, zoom, spacing, theme, page width, and page-step controls remain
in Appearance. Source information below the text contains edition selection,
locators, review scope, original-source attribution, and additional excerpt import.
Selection exposes annotation actions; the annotation-tools fallback and Alt+N
remain available. Continuous reading scrolls the document, rather than nesting a
scrolling source pane. Source text, hashes, Unicode positions, and anchors are
unchanged. Graphs, comparison, research questions, and agents remain available.

## Notebook

Saved entries open as formatted CommonMark/GFM. Click ordinary note text or focus
the document and press Enter to edit; Escape returns to formatted reading. Links,
image-load buttons, and citation controls retain their own actions. Write/Preview
remain as explicit alternatives below the document. The editing area grows with
its content and shares a 20px system-font reading measure with formatted notes.
This is whole-document Markdown editing, not block-level Live Preview.

Title/body edits to active personal notes, questions, interpretations, and objections
save after 1.5 seconds of quiet. A title and body are required. Classification,
connections, withdrawal, source claims, recovered drafts, and conflict resolution
still require explicit save. Saving private writing never publishes it or promotes
scholarly review status. Ordinary recovery status is quiet; recovery failures and
conflicts remain visible. Discard, Trash, export, and history are in note details.

Automatic writes use the existing UUID/CAS/readback authority. Typing remains
possible during an automatic request. Changes made while it is pending are retained,
rebased onto its confirmed revision, and saved in sequence. An uncertain response
stops automatic writes and retains the exact request for explicit retry; newer
writing survives the retry. Explicit saves retain the existing editor lock. Recovery
continues to use private server copies. Research content is never put in localStorage.

## Validation and remaining work

137 frontend unit tests, production build, compiled full-workspace browser suite,
and notebook browser suite. Notebook checks include automatic saves, typing during
a held request, lost response, frozen retry followed by the newer revision, editor
growth, keyboard reading/editing, safe Markdown, exact citations, mobile reflow,
recovery, conflicts, and Trash. The source/notes appearance suite remains required.

Local screenshots of the bounded user-provided Sirry abstract measured the first
source line at y=326.8px in the same 1440px viewport, compared with y=414.8px in the
previous pass. This is a layout measurement, not a user study or accessibility
certification. Preview data remains local; hosted identity and PostgreSQL are not
connected by this change.

Follow-on: one contextual notes/reference sidebar with return-to-notes navigation,
accessible term/citation previews, and explicit open-as-document actions. Existing
source-linked notebook panes and verified research tools remain in place meanwhile.
