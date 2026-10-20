# Arabic selection → English word meanings

Tracking: #184. Preferred full-verse translation: Dr. Mustafa Khattab, *The Clear
Quran*, tracked separately in #185. Word glosses are not a segment alignment of
Talal Itani's English translation, nor are they represented as Khattab's wording.

Select Arabic in the continuous reader. A nearby popover shows the selected words
and their provider-supplied English glosses, plus the existing Note on selection
action. Partial selections expand only the displayed gloss lookup to whole words;
the exact selection used for a note is unchanged. Multiple words retain separate
glosses rather than being assembled into an invented sentence translation. Escape
or the dismiss action closes the popover. No note or highlight is created by
looking up a translation. Native selection changes are observed for touch and
keyboard selection as well as mouse selection.

## Provider and alignment

The signed-owner `GET /v1/quran/words?chapter=4&ayah=59` endpoint requests one verse
from Quran.com's public legacy Content API. It requests English words and Uthmani
word text, ignores the verse-end number, and checks verse identity, word count,
position order and normalized Arabic letters against our immutable Tanzil 1.1
representation. Orthographic comparison removes combining/recitation marks and
tatweel and equates alif-wasla with alif; it never rewrites the displayed Arabic.
Any unmatched verse fails closed. Canonical Unicode offsets and exact source
characters travel with each gloss; the frontend verifies these and the complete
Arabic SHA-256 before displaying the selected words. Selection anchors and existing
notes keep their original resource/version identities.

Source evidence checked 2026-10-19:

- [Content API word fields](https://api-docs.quran.foundation/docs/api/field-reference/)
- [Developer terms](https://api-docs.quran.foundation/legal/developer-terms/)
- [Production credentials and migration](https://api-docs.quran.foundation/docs/quickstart/)
- Live Q 4:59 lookup returned 28 words and aligned against the real pinned Arabic.

The current legacy API works for word glosses without a token. That is not a
guarantee of future availability. There is no fallback to an undocumented website
endpoint or scraped Quran.com page if it stops working. Errors retain the reading
and annotation action and offer an explicit retry.

## Cache, privacy and security review

No new dependency, browser-content persistence, public route or database schema is
introduced. Provider data is not checked into the repository, exported to the
graph, indexed by agents, or bundled for offline use. A process-local 24-hour cache
holds at most 128 verses; expired content is removed on access. Browser display
requests are deduplicated in memory for ten minutes, bounded to 32 verses. A reload
discards that browser cache. This feature does not claim to implement Content Sync.

The network boundary is a fixed HTTPS provider host and integer canonical verse
reference. The API sends no owner notes, selected phrase, project ID, or cookies
upstream. TLS verification remains enabled, redirects are refused, response bytes
are capped at 512 KB and the timeout is eight seconds. Cache misses serialize to
avoid bursts. The existing signed-owner and request-rate boundaries remain in
force. Provider errors are replaced with a bounded service-unavailable message;
untrusted glosses are React text nodes, never HTML.

Threats and controls: forged verse/source data fails identity, hash and alignment
checks (spoofing/tampering); anonymous calls fail owner authentication and the
public runtime has no route (information disclosure/elevation); fixed URLs and
denied redirects prevent arbitrary URL fetching; bounded cache/response/timeout
and existing rate controls limit resource exhaustion. Returned attribution and
access/response hashes record provenance without promoting scholarly review.
The new outbound integration and rendering boundary require security review in
the PR before a hosted release. This is a focused implementation threat analysis,
not a full application security audit.

## Khattab access

The owner requested Dr. Mustafa Khattab, resource 131. The live legacy translation
catalog omits that resource and a verse request does not return its translation.
Production Content API credentials are absent in the inspected runtime. The app
therefore keeps the actual current translator visible and provides a named
Quran.com link for the same verse under Appearance. It does not relabel Talal
Itani's translation or activate an empty/fictional Khattab option.

Activating Khattab inside the reader requires approved production Content API
access, verified resource metadata, appropriate source/footnote handling, and a
retention design for immutable research excerpts under the provider's current
Content Sync and content terms. Credentials stay on the backend. Complete-Quran
production access is distinct from pre-live's two-surah dataset. #185 records
these prerequisites and acceptance checks.

## Verification

Python tests check exact Arabic positions, orthographic-only comparison, wrong
verse/text/count/order/language rejection, bounded request configuration, cache
reuse/expiry, and redirect refusal. HTTP tests cover owner/public separation,
canonical bounds before network access and provider-error redaction. Frontend
tests check Unicode source/hash validation and partial/range selections. The real
reader browser fixture checks visible glosses beside selected Arabic, retained
annotation actions and 390 px popover placement, alongside the existing note,
retry, scope and resize cases. Live provider and local-preview smoke tests use
public source text only; they do not read owner writing or create annotations.
