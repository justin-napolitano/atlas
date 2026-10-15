# Scoped concept lexicon

Implementation in progress for #44, following passage capture and Qur’an links.
This is private hosted application state, not a migration of curated RDF authority.

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
