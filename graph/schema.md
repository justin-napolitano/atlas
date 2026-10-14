# Graph schema

The canonical graph is RDF in Turtle (`research.ttl`), with stable local IRIs and standard vocabularies. CSV files remain convenient import/export indexes. Keep RDF and CSV indexes synchronized when adding substantive records; the RDF graph is authoritative for typed relationships. RDF represents each relationship as a subject–predicate–object triple and can be checked with SHACL.

## Standards used

- **RDF 1.1 / Turtle** is the portable graph model and readable serialization.
- **SKOS** models the project's provisional concept scheme, labels, definitions, and concept links. Our concept scheme is an evolving research aid, not an authoritative taxonomy of Islam.
- **PROV-O** records source, derivation, attribution, and research activity. Provenance indicates where a record came from; it does not establish its truth.
- **AIF** informs argument structure. Represent propositions as information nodes and inference, conflict, or preference applications as scheme nodes. Preserve the AIF rule that propositions connect through scheme applications. The local argument CSV template is AIF-inspired; it must be mapped to an identified AIF RDF/OWL reification before claiming direct AIF conformance.
- **SHACL** shapes express validation rules for the RDF graph.
- **W3C Web Annotation** provides an interoperable body/target/selector pattern for passages. Domain-specific locators (for example, text edition + surah:verse, hadith edition + number, book + page, or manuscript shelfmark) remain explicit because generic selectors do not capture scholarly citation context.
- **ORKG** is a design reference for structured research contributions and comparisons, not a standard or runtime dependency adopted by this repository.

The open standards are specifications, not one monolithic package. SKOS, PROV-O, RDF/Turtle, and SHACL are W3C standards; AIF is an argument interchange ontology. The project vocabulary in the `ir:` namespace supplies research-specific fields where the standards do not define them.

Namespace prefixes are declared in `research.ttl`. Local identifiers use `https://islam-research.local/id/` as a stable project namespace. These IRIs identify records in this local project; they are not presented as globally resolvable URLs. External records should retain their DOI, ORCID, OpenAlex ID, or other authoritative identifiers separately.

Standards references: [RDF 1.1](https://www.w3.org/TR/rdf11-concepts/), [Turtle](https://www.w3.org/TR/turtle/), [SKOS](https://www.w3.org/TR/skos-reference/), [PROV-O](https://www.w3.org/TR/prov-o/), and [SHACL](https://www.w3.org/TR/shacl/). AIF background: [AIF specification](https://www.arg-tech.org/wp-content/uploads/2011/09/aif-spec.pdf).
Web Annotation reference: [Web Annotation Data Model](https://www.w3.org/TR/annotation-model/).

## CSV indexes (working interchange)

`nodes.csv` fields: `id,type,label,description,scope,status,created,updated`

Allowed initial types: `source`, `person`, `text`, `claim`, `hypothesis`, `question`, `method`, `tradition`, `event`, `concept`, `community`, `institution`, `practice`, `observation`, `interpretation`.

IDs use a readable type prefix and stable slug, for example `src:...`, `claim:...`, `hyp:...`, `q:...`. Never reuse an ID for a different thing. Keep descriptions short; put detailed analysis in linked notes.

## Edges

`edges.csv` fields: `id,from_id,relation,to_id,evidence_id,confidence,note`

Use explicit directional relations such as `authored`, `interprets`, `claims`, `supports`, `challenges`, `qualifies`, `contradicts`, `influences`, `responds_to`, `contextualizes`, `tests`, `derived_from`, `translates`, and `cites`. Explain evidential links with a note or evidence record. `confidence` describes confidence in the relationship as entered, not truth of the endpoint claim.

## Evidence records

`evidence.csv` fields: `id,source_id,locator,kind,quote_or_paraphrase,context,stance,translation,accessed,notes`

`kind` is `quotation`, `paraphrase`, `data`, or `bibliographic`. `stance` identifies whether the passage supports, challenges, qualifies, or contextualizes the linked proposition. Include a page, verse/surah, chapter, section, hadith identifier/edition, archival reference, dataset row, or other reproducible locator. Do not use a whole book as the locator when a precise one is available.

Web passage annotations use `templates/web-annotation.jsonld`. Link each annotation target to the source representation and include an edition-aware `ir:locator`; any exact text selector must be verified in context. An annotation note is not itself an attributed claim. Claims separately identify their type (`primary_text_observation`, `historical_claim`, `scholarly_interpretation`, or `researcher_inference`), review status, addressed question, and evidence links.

## Claims and hypotheses

Store one atomic proposition per claim. Record speaker/author, scope, source location, status, and counterevidence. Distinguish what a primary source says from what a scholar argues and what the researcher infers.

A hypothesis must state scope, mechanism, predicted observations, disconfirming observations, alternatives, evidence needed, method, and current status. Metaphysical commitments may be reasoned about but must not be mislabeled empirically testable. See `hypotheses/README.md`.

## Files

`research.ttl` is the RDF source of truth. `shapes.ttl` contains SHACL validation shapes. `templates/` has reusable source, claim/evidence, concept, hypothesis, and argument templates. `argument-networks.csv` carries the AIF-style node and edge model before export to AIF RDF. CSV node, edge, and evidence indexes remain header-only until records are authored; never fabricate evidence just to populate a graph.

## OpenAlex source discovery

Store an OpenAlex Work ID/URL and retrieval date as bibliographic metadata when useful. Citation counts are optional snapshots with coverage and time limits, not intrinsic source properties. Do not collapse source selection into a single numerical rank. Assess direct relevance, primary/secondary role, edition and translation, scholarly context, disciplinary fit, perspective coverage, and evidence quality separately.

Add schema changes here before adopting new fields or relation types. For SHACL conformance, run a SHACL processor against `research.ttl` and `shapes.ttl`; the project does not bundle a processor.
