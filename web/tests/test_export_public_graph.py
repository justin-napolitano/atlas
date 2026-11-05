import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from export_public_graph import export_candidates


class PublicExportTests(unittest.TestCase):
    def test_candidates_only_export_public_bibliography_allowlist(self):
        row = {
            "candidate_id": "doi:10.1234/example", "title": "Example work", "providers": ["Crossref"],
            "provider_id": "10.1234/example", "doi": "10.1234/example", "authors": [{"name": "A Scholar"}],
            "year": 2024, "venue": "Example Journal", "work_type": "article", "landing_page": "https://doi.org/10.1234/example",
            "provider_ranks": {"Crossref": 3}, "queries": ["test query"], "retrieved_at": "2026-10-14T00:00:00Z",
            "abstract": "MUST NOT EXPORT", "local_path": "/private/path", "reviewer_note": "MUST NOT EXPORT", "secret": "MUST NOT EXPORT",
        }
        with tempfile.TemporaryDirectory() as tmp:
            queue = Path(tmp) / "candidates.jsonl"
            queue.write_text(json.dumps(row) + "\n", encoding="utf-8")
            result = export_candidates(queue)
        self.assertEqual(len(result), 1)
        candidate = result[0]
        self.assertEqual(candidate["review_status"], "candidate_unreviewed")
        self.assertEqual(candidate["providers"], ["Crossref"])
        self.assertEqual(candidate["provider_ranks"], {"Crossref": 3})
        self.assertEqual(candidate["queries"], ["test query"])
        self.assertFalse({"abstract", "local_path", "reviewer_note", "secret"} & candidate.keys())


if __name__ == "__main__":
    unittest.main()
