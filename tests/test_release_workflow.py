"""Exercise the actual combined-workflow gate without a GitHub or cloud account."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import textwrap
import unittest


class ReleaseResultTests(unittest.TestCase):
    def gate(self, results):
        workflow=Path(__file__).resolve().parents[1]/".github/workflows/hosted-release-validation.yml"
        source=workflow.read_text(encoding="utf-8")
        # Run the literal checked-in summary step, so its fail-closed behavior is tested.
        script=textwrap.dedent(source.split("python - <<'PY'\n",1)[1].rsplit("\n          PY",1)[0])
        with tempfile.TemporaryDirectory() as directory:
            summary=Path(directory)/"summary.md"
            result=subprocess.run([sys.executable,"-c",script],env={
                "RELEASE_JOB_RESULTS":json.dumps(results),"GITHUB_STEP_SUMMARY":str(summary),
            },capture_output=True,text=True,timeout=10)
            return result,json.loads(result.stdout),summary.read_text(encoding="utf-8")

    def successful(self):
        return {name:{"result":"success","outputs":{}} for name in ("database","frontend","infrastructure","graph","container")}

    def test_success_is_source_evidence_without_deployment_or_launch_claim(self):
        result,report,summary=self.gate(self.successful())
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertEqual(report,{"combined_source_passed":True,"deployed":False,"launch_verified":False})
        self.assertIn("does not deploy resources",summary)
        self.assertIn("Q 4:59",summary)

    def test_failed_skipped_or_cancelled_required_workflow_cannot_pass(self):
        for name in self.successful():
            for status in ("failure","skipped","cancelled"):
                with self.subTest(component=name,status=status):
                    results=self.successful();results[name]["result"]=status
                    result,report,summary=self.gate(results)
                    self.assertNotEqual(result.returncode,0)
                    self.assertFalse(report["combined_source_passed"])
                    self.assertIn(f"| {name} | {status} |",summary)

    def test_missing_or_unexpected_evidence_requires_an_explicit_gate_update(self):
        results=self.successful();del results["infrastructure"]
        result,report,summary=self.gate(results)
        self.assertNotEqual(result.returncode,0);self.assertFalse(report["combined_source_passed"])
        self.assertIn("| infrastructure | missing |",summary)
        results=self.successful();results["unreviewed_extra"]={"result":"success"}
        result,report,_=self.gate(results)
        self.assertNotEqual(result.returncode,0);self.assertFalse(report["combined_source_passed"])
