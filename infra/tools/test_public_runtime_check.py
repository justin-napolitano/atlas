"""Exercise extra v2 coverage without accepting generic anonymous owner services."""
import copy
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "checks"))
from public_runtime import public_contract


def service():
    return {"invoker_iam_disabled": [False], "deletion_protection": [True], "labels": [{"visibility": "approved-public"}],
        "template": [{"service_account": ['${google_service_account.runtime["reader"].email}'],
            "execution_environment": ["EXECUTION_ENVIRONMENT_GEN2"], "max_instance_request_concurrency": [16],
            "timeout": ["30s"], "containers": [{"image": ['${var.public_release.image}']}]}]}


class PublicRuntimeCheckTests(unittest.TestCase):
    def test_expected_isolated_runtime_passes(self):
        self.assertTrue(public_contract("google_cloud_run_v2_service", service()))

    def test_iam_bypass_private_injection_mounts_and_unbounded_profile_are_rejected(self):
        for field, replacement in [("vpc_access", [{}]), ("volumes", [{}]), ("service_account", []),
            ("timeout", ["3600s"]), ("max_instance_request_concurrency", [1000])]:
            conf = service(); conf["template"][0][field] = replacement
            self.assertFalse(public_contract("google_cloud_run_v2_service", conf))
        for field in ("env", "volume_mounts"):
            conf = service(); conf["template"][0]["containers"][0][field] = [{"name": "SYNTHETIC_PRIVATE_INPUT"}]
            self.assertFalse(public_contract("google_cloud_run_v2_service", conf))
        conf = service(); conf["invoker_iam_disabled"] = [True]
        self.assertFalse(public_contract("google_cloud_run_v2_service", conf))

    def test_anonymous_permission_targets_only_explicit_public_service(self):
        conf = {"member": ["allUsers"], "role": ["roles/run.invoker"], "name": ['${google_cloud_run_v2_service.public[0].name}']}
        self.assertTrue(public_contract("google_cloud_run_v2_service_iam_member", conf))
        conf["name"] = ["research-public"]
        self.assertTrue(public_contract("google_cloud_run_v2_service_iam_member", conf))
        for patch in ({"name": ["research-owner-api"]}, {"role": ["roles/run.admin"]}, {"member": ["allAuthenticatedUsers"]}):
            self.assertFalse(public_contract("google_cloud_run_v2_service_iam_member", {**conf, **patch}))
