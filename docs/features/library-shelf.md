# Shared library shelf (#195)

Implementation candidate: PR #200, after merged identity PR #199 and reading stack
#176/#181/#186/#188/#190/#191/#193. Product contracts remain in
[library shelf contracts](library-shelf-contract.md) and the
[design brief](../design/library-shelf-brief.md).

## Delivered behavior

Library is a destination in the existing sidebar. Its compact owner-only rows use
a decorative book glyph, title, responsible people where recorded, selected edition,
honest location and a separate Notes target. No remote cover fetches, second shell,
dashboard detour or private note storage in the browser is introduced. The existing
reader/note typography remains independent of shelf controls.

The shared shelf defaults to All and recently retained order. Reading, Want to read,
Finished, title/creator search and current-project filtering run in PostgreSQL before
pagination. Filtering projects references membership; opening and editing preserve
the original source/note project and IDs. Details allow edition selection, explicit
reading-state changes, project associations and shelf removal. Removing membership
never deletes writing or changes scholarly review/publication.

Sources and supported source, Qur’an and Gutenberg readers expose explicit Save to
library. Indexing and item saves retain their original UUID and CAS payload across
uncertain retries. Choosing a representation in the reader retains that edition.
A source saved without a chosen representation asks for an edition before reading;
unknown work equivalence is never resolved from title similarity.

Continue reading contains at most five retained Reading items with confirmed saved
places, ordered by reading activity. A successful selected-edition place write moves
Want to read to Reading; opening, note editing and library listing do not. Finished
requires an explicit change or the separate reader's own supported completion rule;
opening a finished book leaves it Finished. Start rereading is the explicit Reading
choice in book details. No unsupported percentage or print pagination is invented.

Qur’an resume uses its canonical resource/surah/ayah authority; Gutenberg uses its
retained book version/section/place. Other saved excerpts use the exact original
reading desk document/Unicode position, or the beginning of the selected edition's
first retained document. Preferred-edition changes never move annotations. Conflicting
Gutenberg versions remain an explicit reader error rather than a silent substitution.
The existing per-project single desk/structure-specific place authorities are reused;
this does not create full historical per-edition resume storage.

Notes opens a dismissible context sheet containing the original active written notes
and questions, with their original project. Empty Notes creates no empty notebook.
Selecting existing writing opens its existing notebook editor/source context or exact
annotation. This is a real note index/handoff; the primary running book notebook and
its adjacent grouped writing view remain #95.

Find books switches the library surface to existing Gutenberg discovery. Back restores
shelf query/filter/scroll. Browsing does not retain membership. Native project-independent
catalog Save and atomic first-note retention remain #196; the existing project-bound
reader can be explicitly saved to the shared shelf. Open Library/arXiv are not added.

## API, consistency and access

- GET `/v1/library/shelf`: optional project, `q` (max 300), personal state, opaque
  cursor and limit (default 30, max 50). Only retained items; removed project
  memberships cannot satisfy a project filter. Unavailable rows remain recognizable,
  with no live reading target or private withdrawn-source note count.
- GET `/v1/library/continue`: up to five eligible rows under the same optional project.
- Existing `/library/item`, `/editions`, `/notes`, `/resolve`, `/index-source` and
  `/project-membership` supply mutations, original writing and exact target identity.

Pagination uses `(retained_at, id)` descending and is eventually consistent under
concurrent retention/removal/state edits. An item re-retained ahead of a loaded
cursor appears on refresh, not by resetting the user's page mid-read. The frontend
deduplicates appended IDs. This is not snapshot isolation. Continue has no cursor.
Note counts are a fixed batch query; there is no per-row note request or provider
request while listing/filtering/searching saved books. Public mode registers no
shelf routes and has no access to owner-library tables.

Threat boundaries: all shelf queries remain on the verified owner router; existing
same-origin JSON/CSRF requirements guard writes. Cursor/filter inputs are bounded
and parsed, SQL uses parameters, labels/body snippets are React text, remote metadata
cannot authorize identities, and no new grants/auth/CORS/dependencies are added.
New private data-access projections and reading-state hooks need owner/security
review before release. The user authorized merging the prior PR stack; this shelf
is a separate reviewable PR.

## Validation and limits

Tests cover server filtering/pagination, edition gating, exact source bookmarks,
Qur’an/Gutenberg native places, explicit removal preserving text, Finished preservation,
other-edition nonpromotion, private/public API boundaries, indexing/CAS frozen retries,
zero-note opening without authoring, keyboard reader opening, 390px layout and 200%
zoom in the assembled application. Evidence/current CI status belongs to PR #200;
local skipped PostgreSQL tests do not establish database behavior.

The separate local review uses fresh demo state on port 5185, not the owner's
5183/5184 reading state. It is a local JSON adapter, not hosted PostgreSQL/two-device
proof. Owner reading acceptance (#146), hosted deployment/backup proof (#42), primary
book notebook (#95), native global first-note/catalog retention (#196), and broader
merge/split/export reconciliation (#101) remain separate. No owner writing was read,
exported or used as a test fixture.
