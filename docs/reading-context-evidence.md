# Context, comparison, and evidence navigation

The owner workspace can open two saved source representations side by side.
Each pane chooses its own source and immutable document, preserves edition,
locator, notice and text hash, and scrolls independently. The URL retains both
source/document pairs for reload and Back/Forward. Open a pane in the ordinary
reader to annotate that exact version. Missing saved text remains an explicit
gap; matching references do not imply translation equivalence or alignment.

Every record has a bounded **Connections & source context** panel backed by
`GET /v1/record-context`. It returns only direct, recorded relations in the
selected project, with actual direction, review state and provenance. Page by
stable relation ID; both endpoints must remain active. This read uses one
repeatable-read snapshot. It does not infer author identity, school membership,
influence, agreement, support, or scholarly importance from adjacency.

Questions additionally show registered evidence paths as selectable, directed
steps. Each claim, evidence record and source opens separately; relationship
bases and locators remain visible. Source steps can list actual saved excerpts
and open or compare the chosen version. A bibliographic locator alone is never
treated as a verified annotation selector. No source text is silently reanchored.

This design uses native HTML directed paths and relationship lists with the same
keyboard-accessible controls on desktop and mobile. It has no layout simulation,
animation, new renderer dependency, or implicit graph-score ranking. Context
lists are bounded to 25 relationships per request; comparison text has bounded
scroll regions and stacks on narrow screens. Red marks the path, neutral text
retains context, and review states remain explicit text in either theme.

Validation covers mixed-project/source rejection, direction and endpoint checks,
real PostgreSQL pagination/tombstone boundaries, owner authentication/public
route exclusion, comparison edition independence, URL reload, source return,
and the existing reader/publication browser flows. Live hosted cross-device
acceptance remains separate from compiled browser adapters.
