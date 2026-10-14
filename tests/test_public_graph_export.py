import importlib.util
from pathlib import Path
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


if __name__ == "__main__":
    unittest.main()
