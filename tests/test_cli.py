import json
from pathlib import Path
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from islam_research import cli


class SearchPlanSchedulingTests(unittest.TestCase):
    def test_plan_rotates_provider_start_order_without_parallel_calls(self):
        with tempfile.TemporaryDirectory() as temp:
            temp_path = Path(temp)
            plan = temp_path / "plan.json"
            plan.write_text(json.dumps({
                "id": "test-plan",
                "providers": ["openalex", "crossref", "datacite"],
                "queries": [{"text": f"query {i}"} for i in range(1, 4)],
            }), encoding="utf-8")
            observed = []

            def fake_run(command, **kwargs):
                observed.append(command[command.index("--provider") + 1])
                return SimpleNamespace(returncode=0, stderr="")

            with patch.object(cli, "ROOT", temp_path), patch.object(cli, "LIBRARY", temp_path / "library"), patch.object(cli.subprocess, "run", side_effect=fake_run):
                result = cli.run_plan(SimpleNamespace(plan=plan))

            self.assertEqual(result, 0)
            self.assertEqual(observed, [
                "openalex", "crossref", "datacite",
                "crossref", "datacite", "openalex",
                "datacite", "openalex", "crossref",
            ])
            manifests = list((temp_path / "library" / "searches").glob("*/run.json"))
            manifest = json.loads(manifests[0].read_text(encoding="utf-8"))
            self.assertEqual(manifest["request_policy"]["mode"], "sequential_round_robin")


if __name__ == "__main__":
    unittest.main()
