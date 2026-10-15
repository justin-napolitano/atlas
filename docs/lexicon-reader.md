# Concepts and definitions in the owner reader

The signed-owner workspace uses the private lexicon API to connect reading
passages to scoped concepts, record attributed definitions, and follow their
original source locations. It retains the textbook layout, resizable panes,
theme preference, and existing record/passage notes. This is an owner workflow;
it does not change the anonymous viewer or publish lexical material.

## Read, connect, and return

1. Open a source/work/edition in `/workspace.html`, import/select the identified
   reading version if needed, and save a located passage note.
2. Expand **Concepts & definitions** on that saved passage. Existing connections
   load from the API, so they survive reload and can reopen their concept pages.
3. Choose **Connect a word or phrase**. The saved quotation is the default wording;
   select a narrower word/phrase inside it and use **Use selected wording** when
   the quotation contains more context. Positions remain Unicode code points.
4. Search existing concepts, or provide a new label and scope note. Record the
   meaning/scope in this reading and why the connection is warranted. Language
   defaults to `und` (undetermined); declare script/transliteration when known.
   New entries remain grammatically undetermined. A scope note is not a definition.
5. To reuse an entry/meaning, explicitly choose its recorded connection and exact
   spelling. Both connection and spelling choices paginate. Other spellings need
   the explicit source-grounded representation API; this UI does not silently
   classify a spelling variant, translation, or synonym.
6. **Save concept connection** sends an explicit private owner choice. The reader
   verifies the stored occurrence, source snapshot, sense/concept, and spelling
   identities before confirming success. It creates no canonical RDF assertion
   or scholarly-review promotion.

Concept pages independently load recorded definitions, private reading
occurrences, and scoped lexical connections. Follow a source button to reopen
its exact captured annotation and edition/locator; Back/Forward and the
project/record/annotation URL use the existing workspace navigation. Occurrences
display the original quotation with the term highlighted, not a normalized rewrite.
The source reader reopens the captured quotation; a subterm remains identified
inside that original quotation rather than silently relocating to another edition.

The concept description appears separately from located definition assertions.
Missing recorded definitions remain an explicit gap. Machine-only proposals do
not fill it and are shown in their own expandable section. Every assertion keeps
its kind, attribution, scope, wording mode, dating note, source, and pending review.
Multiple definitions remain separate, with paging rather than selecting one as truth.

## Record a definition and correct it

From a saved source passage, choose **Record a definition from this passage**,
select an existing concept, and enter the assertion. The controls distinguish a
source-explicit definition, reference gloss, owner paraphrase, and recorded machine
proposal. A quotation must exactly equal the whole captured quotation; edited
wording must be marked as a paraphrase. Attribution, scope, and rationale are
required. Machine proposals additionally need declared tool/version/activity.
Recording one is not accepting it as a definition or completing review.

On a concept page, **Correct this definition** edits the text, attribution, scope,
dating note, and rationale with a revision check. The source binding, definition
kind, and proposal provenance remain immutable. A reclassification requires a new
assertion through the capture flow. Private revision history is available and paged.
The UI does not expose entry/form reclassification, explicit assertion withdrawal
or reactivation, merge/split/alias operations, or independent editorial approval;
the supported owner API operations and wider roadmap remain documented separately.

Conflict comparison retains the local fields and shows the cloud text,
attribution, scope, wording mode, dating note, rationale, state, and revision. The
owner chooses the cloud version or keeps the draft against that confirmed revision
and explicitly saves again. An exact interrupted correction retry is idempotent.
A remote withdrawal remains withdrawn; coverage can refresh without silently
reactivating the assertion. An authorized separate client's explicit reactivation
can be seen with **Refresh concept**. History remains private.

## Drafts and save uncertainty

Unsaved creation/correction drafts survive record navigation in page memory and
participate in the existing unload warning. They are not uploaded automatically
or persisted to localStorage. Closing/reloading with an unsaved draft can lose it;
explicit **Export retained draft** / **Export correction draft** downloads private
JSON with source IDs and the retained fields. This is a recovery artifact, not
implemented automatic Obsidian sync or JSON import.

After an uncertain creation response, fields lock around the exact original
request/UUID. **Retry exact save** can confirm it without creating duplicate
entities. A known initial validation rejection leaves fields editable. A later
rejection after prior uncertainty does not unlock/rewrite that original intent.
No mismatched source/project response is adopted as a confirmed save. A temporary
sign-in/network failure retains the draft rather than treating it as saved.

Correction drafts remain editable after a failed response; the next revision check
protects against overwriting a prior committed value. A conflict requires comparison
and an explicit choice. Saving does not update source verification, mark a reading
as completed, or publish the passage/definition.

## Search and coverage

**Concept words & definitions** uses the owner's bounded lexical API and displays
the original matched wording and assertion kind. **All my research** combines the
existing owner record/note/passage search with lexical concept hits when the kind
filter allows concepts. Duplicate concept IDs retain both match channels. Existing
record ordering is preserved and additional lexical hits follow; there is no
new global relevance/quality score. Each backend applies project/owner filtering
before returning its bounded matches. Truncation asks the user to narrow the query.
Other clients use the same registered endpoints; this UI fusion does not replace
them with a free-form query executor.

Concept/definition/occurrence/history choices paginate. Coverage describes active
private indexed records, not comprehensive historical usage. Repeated annotations
may describe repeated reading encounters at the same source location; their number
is not evidence of influence, truth, semantic change, or consensus. Public source
counts and projections do not consume these private tables.

## Verification boundary

The browser harness compiles the real UI and uses synthetic authenticated API
responses. It exercises exact term capture, saved-link reload, definition gaps,
separate proposals, quotations/paraphrases, interrupted creation/correction,
conflicts, history, remote withdrawal, reuse, normalized/combined search,
pagination, Arabic/RTL text, and dark/mobile overflow. Synthetic browser fixtures
are not a hosted login or real cross-device persistence test. The parent lexicon
API PR separately checks actual PostgreSQL 17/18 and signed-owner HTTP/database
round trips. The combined release gate also checks public-only artifact/container
isolation, graph/semantic contracts, and mock infrastructure policy.

Live owner identity, PostgreSQL/GCP deployment, restarts/two independent devices,
reviewed pilot definitions, public lexical publication, full Obsidian exchange,
concept relations, redirects, and timelines remain acceptance work. No new real
source reading, peer review, deployment, or billable resource is claimed here.
