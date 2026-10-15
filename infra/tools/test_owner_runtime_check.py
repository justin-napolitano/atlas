"""Reject real owner delivery regressions in the same parsed Terraform contract."""
import copy
from pathlib import Path
import sys
import unittest
from checkov.terraform.tf_parser import TFParser
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'checks'))
from owner_runtime import owner_contract


class OwnerRuntimeCheckTests(unittest.TestCase):
    def setUp(self):
        source = Path(__file__).resolve().parents[1] / 'gcp/owner.tf'
        parsed = TFParser().parse_file(str(source), {})
        self.service = next(row['google_cloud_run_v2_service']['owner'] for row in parsed['resource'] if 'google_cloud_run_v2_service' in row)
        self.binding = next(row['google_iap_web_cloud_run_service_iam_binding']['sole_owner'] for row in parsed['resource'] if 'google_iap_web_cloud_run_service_iam_binding' in row)

    def test_real_owner_contract_and_graph_resolved_identity_pass(self):
        self.assertTrue(owner_contract('google_cloud_run_v2_service', self.service))
        self.assertTrue(owner_contract('google_iap_web_cloud_run_service_iam_binding', self.binding))
        self.service['template'][0]['service_account'] = ['google_service_account.runtime["owner-api"].email']
        self.assertTrue(owner_contract('google_cloud_run_v2_service', self.service))

    def test_authentication_identity_network_and_proxy_regressions_fail(self):
        for field, value in [('iap_enabled', [False]), ('invoker_iam_disabled', [True]), ('deletion_protection', [False])]:
            changed = copy.deepcopy(self.service); changed[field] = value
            self.assertFalse(owner_contract('google_cloud_run_v2_service', changed))
        for field, value in [('service_account', ['default@example.invalid']), ('max_instance_request_concurrency', [1000]), ('vpc_access', [{'egress': ['ALL_TRAFFIC']}])]:
            changed = copy.deepcopy(self.service); changed['template'][0][field] = value
            self.assertFalse(owner_contract('google_cloud_run_v2_service', changed))
        changed = copy.deepcopy(self.service); changed['template'][0]['containers'][1]['args'] = [['--private-ip']]
        self.assertFalse(owner_contract('google_cloud_run_v2_service', changed))
        for members in [[], ['allUsers'], ['user:a@example.invalid', 'user:b@example.invalid']]:
            changed = copy.deepcopy(self.binding); changed['members'] = [members]
            self.assertFalse(owner_contract('google_iap_web_cloud_run_service_iam_binding', changed))
