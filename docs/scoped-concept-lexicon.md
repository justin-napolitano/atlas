# Scoped concept lexicon

The private owner API stores scoped lexical entries, source-grounded occurrences,
and independently attributed definitions for #44. Reader controls and public
lexical projection remain separate work. Curated RDF authority is unchanged.

## Standards assessment

[SKOS Reference](https://www.w3.org/TR/skos-reference/) supplies identified concepts,
labels, scope notes, and explicit broader/narrower/related relationships. It is a
W3C Recommendation. [OntoLex-Lemon's 10 May 2016 Community Report](https://www.w3.org/2016/05/ontolex/)
is a community specification, not a W3C Recommendation. It separates lexical
entries, forms, written representations, and lexical senses. Forms concern
grammatical realization; spelling variants are not automatically different
grammatical forms. A lexical sense links an entry to a referent.

| Identity | Meaning and authority |
| --- | --- |
| Concept | Existing `research.records` kind `concept`, preserving imported IDs. A label/scope note is not a sourced definition. Imported concepts stay read-only under canonical RDF authority. |
| Lexical entry | An owner-scoped word/term identity, initially of undetermined grammatical type. Equal spellings do not imply equal entries. |
| Form | A grammatical realization, initially undetermined. Canonical status is explicit, never inferred from selection. |
| Written representation | Exact spelling, declared language/script, optional declared transliteration scheme, and grouping rationale. Original characters remain unchanged. |
| Sense | An explicitly chosen entry–concept connection with scope and rationale, initially unreviewed. |
| Definition assertion | Located, attributed text typed as source-explicit definition, reference gloss, owner paraphrase, or recorded machine proposal. Scope, dating uncertainty, wording mode, and provenance remain attached. |
| Occurrence | Exact wording at code-point positions inside a captured annotation, bound to its document/hash and chosen representation/sense. It does not prove historical influence. |

This private model is informed by OntoLex, not claimed as fully conformant RDF.
Publication/export mappings need independent validation before asserting OntoLex
entailments. Scope and definition attribution are local research assertions;
they do not assert universal meanings, translation equivalence, or `owl:sameAs`.
No SKOS broader/related/exact-match relationship is inferred from shared words.

Capture creates identities and a located occurrence transactionally. Definitions
are separate assertions. A concept without accessible active definitions shows a
gap; differing definitions remain independent. Selecting a definition type is
not completed scholarly review. Definition quotations must equal the cited
captured quotation; paraphrases remain labeled and located. Recorded machine
proposals retain declared tool/version/activity provenance and stay unreviewed.

Project-scoped foreign keys and runtime column grants protect these private tables.
Original source bindings and spellings are immutable. Mutable assertions compare
revisions and retain history. Capture UUID/fingerprint retries prevent duplicate
entities after a lost response. No endpoint grants agents owner credentials.

Retrieval normalization is versioned and never used as identity or deduplication.
Arabic/diacritics, transliteration, and edition/locator stay visible. The selected
public record projection remains separate from private lexical occurrences.

Public lexical projection, reviewed RDF/OntoLex export, concept relationships,
merge/split/alias redirects, bulk Obsidian exchange, historical timelines, live
cross-device deployment, and reviewed pilot definitions remain in #44/#46 and
the wider roadmap. No meanings or historical evidence are invented here.

## Authoring protocol

All routes are inside the existing signed-owner/IAP boundary, with the same-origin
JSON write/CSRF checks and literal `owner_confirmed: true` on mutations. These are
not public agent credentials. The actor comes from the verified identity, never
the submitted payload. The owner/public OpenAPI contracts document every field.

| Operation | Contract |
| --- | --- |
| `POST /v1/lexicon/captures` | One transaction creates/reuses a concept, entry, form, representation, sense, and exact occurrence. Supply a fresh retained UUIDv4, source annotation, term start/end relative to its exact quotation, rationale, and explicit entity choices. The response contains stable IDs; fetch current entities separately. |
| `POST /v1/lexicon/representations` | Explicitly group an exact spelling from another captured passage into a chosen form. Preserve its own annotation and code-point origin. Language/script/transliteration and grouping rationale are owner declarations, not inference. |
| `POST /v1/lexicon/definitions` | Create an independently identified definition with source annotation, concept and optional sense/person, assertion kind, quotation/paraphrase mode, text, attribution, scope, dating note, and rationale. Machine proposals additionally require declared tool/version/activity. |
| `PUT /v1/lexicon/definition` | Compare revision and correct text/attribution/scope or withdraw an assertion. Kind, target, original proposal provenance, and optional person identity are immutable; reclassification needs a new assertion and withdrawal of the old one. |
| `PUT /v1/lexicon/connection` | Compare revision and correct sense scope/rationale or withdraw/restore a sense/occurrence. An occurrence cannot become active under a withdrawn sense. |

Capture choices are explicit:

- New sense: choose a new lexical entry or an existing representation, then a new
  or existing concept, and provide sense scope. Existing canonical concept IDs
  are read and referenced without rewriting their label, scope, or origin.
- Existing sense: supply that sense and an exactly matching representation from
  its entry. New entry/concept/scope fields are rejected. A second spelling first
  needs an explicit representation under the same form/entry.

New forms start `undetermined`. No lemmatization, part-of-speech classification,
canonical form, synonymy, or translation relationship is inferred. The initial
API does not edit entry/form classification or merge/split identities. Equal
spellings may remain separate entries/meanings. Reusing an existing entry/concept
pair requires choosing its existing sense; the service does not silently reuse it.

Exact capture request retries return the same identifiers, even after a lost
response. A different payload/actor with the same request ID is rejected. Requests
serialize on a scoped advisory-lock namespace and read the completed request
after acquiring the lock under READ COMMITTED. Failure rolls back the entire
bundle, including record and lexical history. Duplicate occurrences with different
request IDs are rejected, not silently cloned or merged.

Definition creation has a retained UUIDv4. Correction/withdrawal uses the last
confirmed revision; a stale change returns a project-scoped conflict. An exact
retry after a lost update response returns the committed next revision without
duplicating history. Withdrawal preserves prior content/history. Machine-only
proposals leave `definition_gap` true. Recorded owner/source/reference definitions
fill the *recorded* gap but remain pending scholarly review.

## Retrieval and semantic discovery

`GET /v1/lexicon/concept` returns the existing concept record, explicit definition
gap, and coverage/review limits. It does not promote the concept scope note into a
definition. Independently paginated `senses`, `representations`, `definitions`,
and `occurrences` routes retain original wording and IDs. Pages are limited to 25
with stable ID cursors. Definition and occurrence results include the source
record, edition, locator, annotation, snapshot hash, and bounded quotation, so a
client can reopen the exact reading passage. Withdrawn/deleted-source results are
excluded from active concept views; no public counts are derived from them.

`GET /v1/lexicon/entity` reopens one typed private entity, including withdrawn
assertions. `GET /v1/lexicon/history` returns at most 25 prior snapshots, newest
first, with a numeric revision cursor. Both verify project membership before
returning an entity or its history. There is no arbitrary-table/query parameter.

`GET /v1/lexicon/search` returns up to 30 matching concepts with the actual match
channel, original spelling/text, and definition assertion kind when applicable.
It uses PostgreSQL simple lexical matching and a stable identity order; it is not
embedding search or a scholarly-quality ranking. A truncated response asks the
caller to narrow the query, not to infer exhaustive corpus coverage.

Representation/definition retrieval normalization `lexicon-search-1` applies
Unicode case-folding and NFD decomposition, removes combining marks and Arabic
tatweel, and collapses whitespace. It aids retrieval only: `tafsīr` can match
`tafsir`, while `exegesis` and Arabic wording are not assumed equivalents. Concept
label/scope matching uses the existing literal PostgreSQL simple-text index.
Language tags are checked for RFC 5646-shaped syntax, including duplicate
variant/extension checks and grandfathered/private-use forms; this is not IANA
registry verification or automatic language detection. Script codes are checked
for four-letter shape and conflicting language-script declarations. The original
declarations remain intact.

The pinned private Ossie model describes thirteen datasets, adding these six
lexical datasets and their project-scoped composite joins to concepts, annotations,
and source snapshots. Search keys, capture retry logs, and history internals are
not exposed as semantic datasets. `/v1/research-operations` advertises the registered
lexicon routes and bounds. SQL expressions remain interchange metadata and are
never executed from a caller-supplied model.

## Storage boundary and verification

Migration `0008_private_scoped_lexicon.sql` adds private tables only. Runtime grants
allow selected insert/update columns, not identity/source rewrites, review
promotion, deletion, history mutation, or DDL. Source/sense/representation joins
and exact quoted wording are checked in SQL as well as Python. A fixed-path
security-definer trigger writes history; its function has no runtime/PUBLIC
EXECUTE grant, and the owner cannot create objects in its schema. The explicit
request log is immutable. Public readers have no private schema/table access.

Real PostgreSQL 17/18 tests cover restricted-role capture, concurrency/retry,
rollback, variant origins, imported concept preservation, definitions and gaps,
CAS/history/withdrawal, wrong projects, and publication exclusion. HTTP tests use
signed synthetic owner assertions with actual database writes/reads and compare
two API instances; they are not proof of deployed cross-device IAP sessions.
Pure tests cover normalization, language/script syntax, Unicode term boundaries,
quotation integrity, and declared proposal provenance. Run the existing full
PostgreSQL workflow and combined release gate before release. No browser lexical
authoring flow or reviewed pilot definition is claimed by these backend tests.
