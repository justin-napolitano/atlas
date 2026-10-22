# Optional subpage contents

Owner direction, 2026-10-21: contents is an insertion, never a compulsory page section.

In an ordinary standalone note line, type `/toc` (or `/toc subpages`) and choose the
keyboard suggestion with Enter/Tab; Escape leaves the literal writing alone. The
editor inserts `<!-- atlas:subpages -->` followed by an editable blank line. Normal
undo or deleting that marker removes the block; no children are deleted or moved.
The marker round-trips as exact Markdown through the existing save/vault authority.
It is not the page's automatic title.

The rendered block lists direct active subpages alphabetically, using their actual
saved hierarchy and stable IDs. Twenty results load at a time with explicit More.
Links open in the same workspace and support normal keyboard focus/activation.
It refreshes after returning to the parent and organization changes. Empty contents
shows a quiet placeholder. Existing automatic child listings below every page are
removed; backlinks remain available separately. Neither code examples nor other HTML
activate the component. Outside an owner page, the marker cannot fetch private data.

Validation: 184 frontend tests and two Python title tests pass. Synthetic native
Electron verifies optional insertion, no automatic contents, live child creation,
keyboard navigation, exact body persistence and reload. No owner notebook is used.
The native runner is `scripts/check_vault_desktop.py --frontend <compiled owner UI>
--toc --artifacts <synthetic output directory>`.
