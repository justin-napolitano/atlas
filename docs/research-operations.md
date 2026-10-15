# Executable research operations

The owner API executes two named evidence paths and five explainable weighted profiles from the packaged `src/islam_research/policies/research-policy.json`. Ossie remains an interchange description; its SQL expressions are never executed. The policy retains its `definition_only` metadata status because schema validation does not certify execution. `/v1/research-operations` separately identifies the implemented executor version.

## Follow a question to sources

`GET /v1/evidence-path?project_id=…&record_id=…&profile_id=question_evidence_trail` follows explicit typed links: question ← claim addressing the question → located evidence record → source representation.

Results contain complete paths with stable record/relation IDs, actual directed edges, full source/evidence attributes (including imported citation locators), record revisions, provenance, review scope, and the policy hash/version. Results also include explored partial branches; use `paths` to identify complete trails. The separate `claim_attribution` profile returns direct claim-to-speaker/source links. Attribution alone is not located evidence.

Database traversal runs in one read-only, repeatable-read transaction. Each step filters project, endpoint types, and deleted records before its ordered limit. Owner verification precedes the store call. This is not a general multitenant authorization system: future collaborators/public snapshots require an appropriately filtered provider and tests. The public service registers none of these private endpoints.

Simple paths cannot revisit a record. Registered depth/node/edge limits apply, with at most 500 expanded paths per step. `truncated: true` means limits prevented a complete search. An empty result means no complete path was returned in the selected graph, not absence of evidence in the literature. Imported claims remain pending at the application layer; original review limitations remain in their attributes.

Local non-AI exploration, without PostgreSQL or sign-in:

```sh
uv sync --extra graph --extra database --extra semantic
uv run --no-sync python scripts/explore_graph.py \
  --start https://islam-research.local/id/pilot-question
```

This reads canonical Turtle without changing it. The current pilot yields three complete source trails, including the exact snapshot hash. The local command has no web authorization boundary; run it only on a snapshot you are entitled to read.

## Explain a score

`POST /v1/rank` accepts a registered `profile_id` and up to 100 unique candidates. Each supplied feature needs a normalized `value` from zero through one and a nonempty `basis` describing the observation. Example body:

```json
{
  "profile_id": "discovery_relevance",
  "candidates": [{
    "id": "urn:example:source",
    "features": {
      "query_match": {"value": 0.8, "basis": "Owner assessment against the stated query"},
      "scope_match": {"value": 1, "basis": "Owner assessment against the bounded corpus"}
    }
  }]
}
```

Responses return every value, basis, weight, weighted contribution, missing feature, profile version, and policy hash. Known scores sort descending with stable-ID tie breaks; unknown scores follow. Missing inputs propagate an unknown score rather than an invented zero or renormalized partial score. Invalid, unregistered, duplicate, boolean, non-finite, and out-of-range inputs fail validation. Signed-owner and write-header/origin rules apply; this calculation does not persist records.

These are **owner-supplied observations**, not automatically extracted or validated measurements. Complexity extraction, familiarity inference, scholarly quality judgment, and consensus calculation are not implemented. Higher article-complexity scores mean greater declared demands; higher personal-preparation scores mean more declared unfamiliarity. The dimensions stay separate. Connectivity is graph-specific, never academic merit. Calibrated extraction, persisted evaluations/revisions, editable owner profile versions, and public-safe ranking remain follow-up work in #36/#55.

## Verification

`tests/test_graph_engine.py` checks directed trails, unknown operations, endpoint/project/deletion rejection, incomplete paths, truncation, cycles, explanations, unknown values, and invalid inputs. Its real PostgreSQL case traverses an inserted chain, verifies project isolation, and excludes a tombstoned source. HTTP tests verify signed-owner requirements and absence of operations from public mode. CI also checks OpenAPI drift and pinned offline semantic contracts.
