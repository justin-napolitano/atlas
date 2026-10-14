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

    def test_interrupted_plan_checkpoints_and_resume_skips_completed_requests(self):
        with tempfile.TemporaryDirectory() as temp:
            temp_path = Path(temp)
            plan = temp_path / "plan.json"
            plan.write_text(json.dumps({
                "id": "resumable-plan",
                "providers": ["openalex", "crossref"],
                "queries": [{"text": "first question"}, {"text": "second question"}],
            }), encoding="utf-8")
            args = SimpleNamespace(plan=plan, resume=None, min_interval=None, max_hours=None)
            first_calls = []

            def interrupt_after_one(command, **kwargs):
                first_calls.append(command[command.index("--provider") + 1])
                if len(first_calls) == 2:
                    raise KeyboardInterrupt
                return SimpleNamespace(returncode=0, stderr="")

            library = temp_path / "library"
            with patch.object(cli, "ROOT", temp_path), patch.object(cli, "LIBRARY", library), patch.object(cli.subprocess, "run", side_effect=interrupt_after_one):
                self.assertEqual(cli.run_plan(args), 130)

            manifest_path = next((library / "searches").glob("*/run.json"))
            saved = json.loads(manifest_path.read_text(encoding="utf-8"))
            self.assertEqual(saved["status"], "interrupted")
            self.assertEqual(saved["progress"]["completed_provider_queries"], 1)

            resume_calls = []
            def finish_resume(command, **kwargs):
                resume_calls.append(command[command.index("--provider") + 1])
                return SimpleNamespace(returncode=0, stderr="")

            args.resume = saved["run_id"]
            with patch.object(cli, "ROOT", temp_path), patch.object(cli, "LIBRARY", library), patch.object(cli.subprocess, "run", side_effect=finish_resume):
                self.assertEqual(cli.run_plan(args), 0)
            final = json.loads(manifest_path.read_text(encoding="utf-8"))
            self.assertEqual(final["status"], "complete")
            self.assertEqual(final["progress"]["completed_provider_queries"], 4)
            self.assertEqual(len(resume_calls), 3)


if __name__ == "__main__":
    unittest.main()
