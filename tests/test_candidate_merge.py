import json
from pathlib import Path
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from islam_research import cli


class CandidateMergeTests(unittest.TestCase):
    def test_merges_provider_and_rank_provenance_across_snapshots(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            run_id = "test-run"
            run_dir = root / "library" / "searches" / run_id
            run_dir.mkdir(parents=True)
            manifest = {
                "plan_id": "test-plan",
                "queries": [
                    {"query": "authority", "output": f"research-library/searches/{run_id}/openalex.jsonl"},
                    {"query": "authority", "output": f"research-library/searches/{run_id}/crossref.jsonl"},
                    {"query": "interpretation", "output": f"research-library/searches/{run_id}/openalex-2.jsonl"},
                ],
            }
            (run_dir / "run.json").write_text(json.dumps(manifest), encoding="utf-8")
            snapshots = {
                manifest["queries"][0]["output"]: {"record_id": "doi:10.example/1", "title": "Authority", "provider": "OpenAlex", "provider_id": "https://openalex.org/W1", "provider_rank": 4, "provider_ranks": {"OpenAlex": 4}, "providers": ["OpenAlex"]},
                manifest["queries"][1]["output"]: {"record_id": "doi:10.example/1", "title": "Authority", "provider": "Crossref", "provider_id": "10.example/1", "provider_rank": 2, "provider_ranks": {"Crossref": 2}, "providers": ["Crossref"]},
                manifest["queries"][2]["output"]: {"record_id": "doi:10.example/1", "title": "Authority", "provider": "OpenAlex", "provider_id": "https://openalex.org/W1", "provider_rank": 1, "provider_ranks": {"OpenAlex": 1}, "providers": ["OpenAlex"]},
            }
            for relative, record in snapshots.items():
                output = root / relative
                output.parent.mkdir(parents=True, exist_ok=True)
                output.write_text(json.dumps(record) + "\n", encoding="utf-8")

            with patch.object(cli, "ROOT", root), patch.object(cli, "LIBRARY", root / "library"):
                result = cli.candidates(SimpleNamespace(run_id=run_id, limit=20))

            self.assertEqual(result, 0)
            merged = json.loads((run_dir / "candidates.jsonl").read_text(encoding="utf-8"))
            self.assertEqual(merged["providers"], ["Crossref", "OpenAlex"])
            self.assertEqual(merged["provider_ids_by_provider"], {"OpenAlex": "https://openalex.org/W1", "Crossref": "10.example/1"})
            self.assertEqual(merged["provider_ranks_by_query"], {
                "authority": {"OpenAlex": 4, "Crossref": 2},
                "interpretation": {"OpenAlex": 1},
            })


if __name__ == "__main__":
    unittest.main()
