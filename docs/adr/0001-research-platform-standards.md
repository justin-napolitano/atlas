# ADR 0001: interoperable research records and local workflow

- Status: accepted
- Date: 2026-10-14

## Context

The project needs repeatable discovery, document intake, passage-level evidence, claim tracking, and question-centered reporting. It must stay inspectable, portable, usable on an older Mac, and careful about the difference between machine output and human-reviewed scholarship. There is no single standard that covers bibliography, annotations, arguments, provenance, and research comparisons together.

## Decisions

1. **Canonical graph:** retain RDF 1.1 serialized as Turtle in `graph/research.ttl`. Stable local IRIs identify project records; DOI, ORCID, catalog identifiers, and provider IDs remain identifiers for external records. CSV and JSON are interchange or generated views, not independently edited competing sources of truth.
2. **Concepts:** use SKOS for the provisional project concept scheme. The scheme describes this inquiry and does not claim to define Islam authoritatively.
3. **Provenance:** use PROV-O for sources, agents, activities, and derivations. Record discovery and extraction as activities; provenance does not establish truth.
4. **Passages:** use the W3C Web Annotation model when its body/target/selector structure fits. Store exact domain locators as explicit project data too: Qur'an surah/verse and edition/translation; hadith collection/edition/number; book/chapter/page; manuscript shelfmark; archival or dataset identifiers. A quote selector is an aid to locating a passage, not a substitute for edition-specific citation.
5. **Validation:** use SHACL for graph constraints. Validation checks record structure and links, not interpretation or truth.
6. **Research comparisons:** use ORKG as a design reference for structured contributions and comparisons. The project does not depend on or claim conformance to ORKG.
7. **Local-first execution:** keep discovery, extraction, review, and reports runnable locally with a lightweight Python CLI. Search terms may be sent to configured public metadata providers; local documents, extracted full text, and private notes remain local by default.
8. **Human review:** machine-discovered, machine-extracted, human-verified, and researcher-synthesized records have explicit separate statuses. Programs never silently promote candidates into accepted sources, evidence, or conclusions.
9. **Storage:** do not add a database or graph server yet. If later query performance requires an index, derive it from the canonical RDF and make it regenerable.

## Record mapping

| Project record | Standards mapping | Project-specific information |
| --- | --- | --- |
| Bibliographic source | RDF; Dublin Core Terms; PROV-O | Source role, tradition, period, language, review status, provider IDs |
| Passage annotation | Web Annotation `Annotation`, `Body`, `Target`, `SpecificResource`, `Selector` | Edition-aware locator, passage language, transcription/translation distinction |
| Claim/evidence | RDF; PROV-O; Web Annotation when attached to a passage | Atomic proposition, attributed speaker, stance, context, confidence and review status |
| Concept | SKOS | Scope notes and tradition/period qualifications |
| Argument | AIF-inspired information and scheme nodes (see `graph/schema.md`) | Argument role, assumption, counter-reading, researcher assessment |
| Research activity | PROV-O `Activity`, `Agent`, `Entity` | Search plan, extraction tool version, screening rationale |
| Constraints | SHACL | Required project fields and allowed status values |

The existing `data/sources.csv`, `graph/evidence.csv`, Turtle vocabulary, and templates remain migration inputs. New fields should be mapped explicitly before old records are changed.

## Consequences

- Existing RDF, SKOS, PROV-O, and SHACL choices are retained; no wholesale platform migration is needed.
- Passage-level evidence gains an interoperable annotation shape while preserving scholarly locators that generic web selectors cannot express.
- The first implementation can use a small CLI and standard local files; package dependencies are isolated to RDF parsing and SHACL validation.
- Provider coverage, extraction quality, and source evaluation remain visible limitations requiring human review.

## References

- [RDF 1.1 Concepts](https://www.w3.org/TR/rdf11-concepts/)
- [Turtle](https://www.w3.org/TR/turtle/)
- [SKOS Reference](https://www.w3.org/TR/skos-reference/)
- [PROV-O](https://www.w3.org/TR/prov-o/)
- [Web Annotation Data Model](https://www.w3.org/TR/annotation-model/)
- [SHACL](https://www.w3.org/TR/shacl/)
- [FAIR principles](https://www.gofair.foundation/fair-principles)
- [Open Research Knowledge Graph](https://orkg.org/about)
- [Argument Interchange Format](https://www.arg-tech.org/wp-content/uploads/2011/09/aif-spec.pdf)
