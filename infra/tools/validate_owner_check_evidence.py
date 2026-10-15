"""Require actual owner runtime/IAP policy execution and no failed/skipped checks."""
import json
from pathlib import Path
import sys

report = json.loads(Path(sys.argv[1]).read_text())
required = {'google_cloud_run_v2_service.owner', 'google_iap_web_cloud_run_service_iam_binding.sole_owner'}
results = report.get('results', {})
passed = {row['resource'].split('[')[0] for row in results.get('passed_checks', []) if row.get('check_id') == 'CKV_RESEARCH_GCP_2'}
if report.get('check_type') != 'terraform' or not required <= passed or results.get('failed_checks') or results.get('skipped_checks'):
    raise SystemExit('Owner runtime policy did not execute successfully without failures/skips')
print(json.dumps({'owner_policy_executed': True, 'required_resources': sorted(required)}))
