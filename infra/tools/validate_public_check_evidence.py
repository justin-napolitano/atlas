"""Require actual Checkov execution of both public v2 resource checks."""
import json
from pathlib import Path
import sys

CHECK = "CKV_RESEARCH_GCP_1"
REQUIRED = {"google_cloud_run_v2_service.public", "google_cloud_run_v2_service_iam_member.anonymous_public"}


def verify(report):
    if not isinstance(report, dict) or report.get("check_type") != "terraform":
        raise ValueError("Expected Terraform security evidence")
    results = report.get("results", {})
    passed = {row["resource"].split("[")[0] for row in results.get("passed_checks", []) if row.get("check_id") == CHECK}
    if passed != REQUIRED:
        raise ValueError("Public v2 security policy was missing or did not execute on both required resources")
    if results.get("failed_checks") or results.get("skipped_checks"):
        raise ValueError("Infrastructure security evidence contains failed or skipped checks")
    return {"public_v2_policy_executed": True, "resources": sorted(passed), "checks_passed": report["summary"]["passed"]}


if __name__ == "__main__":
    try:
        print(json.dumps(verify(json.loads(Path(sys.argv[1]).read_text())), sort_keys=True))
    except Exception:
        print("Required public v2 policy evidence failed verification.", file=sys.stderr)
        raise SystemExit(1)
