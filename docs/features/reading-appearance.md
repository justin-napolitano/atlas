# Reading appearance

Issue #158 adds presentation controls to every source reader, including the source
pane beside Notes. Defaults are 22px source text, 17px notes, 1.65 line spacing and
a comfortable column. A−/A+ stay visible; one Aa panel contains font, independent
notes size, reading magnification, spacing, width, page color and reading flow.

The three fonts use available system families (Georgia, Palatino, system sans)
with Arabic-capable fallbacks. No fonts or dependencies are downloaded. Reading
zoom scales source and notes while native browser zoom remains available for the
whole application. Explicit page colors are scoped to the reader; App theme
inherits the existing workspace appearance.

Continuous mode scrolls normally. Page steps shows previous/next screen controls
and supports PageUp/PageDown within source text, retaining a line of overlap. It
does not invent print page numbers or imply that source page boundaries changed.

Typography changes capture the visible Unicode reading point and compensate
scroll after reflow. Source text, hashes, selectors and note identities remain
unchanged. Gutter markers remeasure when typography changes.

Only allowlisted appearance values are stored under
`research:reading-appearance:v1` on this device. Bounds and fixed choices reject
arbitrary CSS and strip unknown fields. Notes, reading identities and research
text never enter this preference. Blocked or corrupt storage uses safe defaults;
controls continue to work. Preferences follow reopened cached readers and other
browser windows. This feature does not add hosted preference synchronization.

Validation includes unit checks for bounds/storage/privacy/style generation and a
compiled browser flow covering independent sizes, font/zoom, page colors, reading
position preservation in a long source, page stepping, reopen/reset, Markdown,
source integrity, highlights/markers, conflicts, Trash/Undo and 320px reflow.
