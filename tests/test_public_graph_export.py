import importlib.util
import json
from pathlib import Path
import tempfile
import unittest


MODULE_PATH = Path(__file__).resolve().parents[1] / "web/scripts/export_public_graph.py"
SPEC = importlib.util.spec_from_file_location("public_graph_export", MODULE_PATH)
EXPORTER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(EXPORTER)


class PublicCandidateMergeTests(unittest.TestCase):
    def test_merge_keeps_first_seen_and_combines_safe_provider_provenance(self):
        previous = [{
            "id": "doi:10.example/item", "title": "A work", "providers": ["openalex"],
            "provider_ids": ["W1"], "provider_ids_by_provider": {"openalex": "W1"},
            "queries": ["question one"], "provider_ranks_by_query": {"question one": {"openalex": 3}},
            "discovered_at": "2026-10-01T00:00:00Z", "last_seen_at": "2026-10-01T00:00:00Z",
        }]
        latest = [{
            "id": "doi:10.example/item", "title": "A work", "providers": ["crossref"],
            "provider_ids": ["10.example/item"], "provider_ids_by_provider": {"crossref": "10.example/item"},
            "queries": ["question two"], "provider_ranks_by_query": {"question two": {"crossref": 1}},
            "discovered_at": "2026-10-14T00:00:00Z", "last_seen_at": "2026-10-14T00:00:00Z",
        }]
        merged = EXPORTER.merge_public_candidates(previous, latest)
        self.assertEqual(len(merged), 1)
        self.assertEqual(merged[0]["providers"], ["crossref", "openalex"])
        self.assertEqual(merged[0]["discovered_at"], "2026-10-01T00:00:00Z")
        self.assertEqual(merged[0]["last_seen_at"], "2026-10-14T00:00:00Z")
        self.assertEqual(set(merged[0]["queries"]), {"question one", "question two"})

    def test_merge_applies_public_candidate_limit(self):
        records = [{"id": str(index), "last_seen_at": f"2026-10-{index + 1:02d}"} for index in range(5)]
        self.assertEqual(len(EXPORTER.merge_public_candidates([], records, limit=3)), 3)

    def test_public_build_summary_distinguishes_empty_searches_and_preserves_last_success(self):
        manifest = {
            "status": "partial_failure",
            "progress": {"completed_provider_queries": 1, "total_provider_queries": 3},
            "private_path": "/Users/private/research-library",
            "queries": [
                {"provider": "openalex", "status": "complete"},
                {"provider": "datacite", "status": "partial_failure", "stderr": "No results were retrieved."},
                {"provider": "crossref", "status": "partial_failure", "stderr": "HTTP 429 private response. No results were retrieved."},
            ],
        }
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "run.json"
            path.write_text(json.dumps(manifest), encoding="utf-8")
            summary = EXPORTER.export_build_summary(
                path, "run-new", {"last_successful_run_id": "run-old", "last_successful_at": "2026-10-01"},
                {"seen"}, [{"id": "seen"}, {"id": "new"}], "2026-10-14T00:00:00Z",
            )
        self.assertEqual(summary["provider_counts"]["datacite"]["no_results"], 1)
        self.assertEqual(summary["provider_counts"]["crossref"]["errors"], 1)
        self.assertEqual(summary["query_complete"], 2)
        self.assertEqual(summary["query_attempted"], 3)
        self.assertEqual(summary["new_leads"], 1)
        self.assertEqual(summary["repeated_leads"], 1)
        self.assertEqual(summary["last_successful_run_id"], "run-old")
        self.assertNotIn("private_path", json.dumps(summary))
        self.assertNotIn("HTTP 429", json.dumps(summary))

    def test_zero_result_provider_responses_still_count_as_a_successful_run(self):
        manifest = {
            "status": "partial_failure",
            "progress": {"completed_provider_queries": 0, "total_provider_queries": 2},
            "queries": [
                {"provider": "datacite", "status": "partial_failure", "stderr": "No results were retrieved."},
                {"provider": "crossref", "status": "partial_failure", "stderr": "No results were retrieved."},
            ],
        }
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "run.json"
            path.write_text(json.dumps(manifest), encoding="utf-8")
            summary = EXPORTER.export_build_summary(path, "empty-run", {}, set(), [], "2026-10-14T00:00:00Z")
        self.assertEqual(summary["latest_run_status"], "complete")
        self.assertEqual(summary["query_complete"], 2)
        self.assertEqual(summary["last_successful_run_id"], "empty-run")


if __name__ == "__main__":
    unittest.main()
