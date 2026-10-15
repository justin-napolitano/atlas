"""Reject missing coverage without mistaking Trivy's omitted false for EOSL."""
import copy
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('owner_container_check', Path(__file__).resolve().parents[1] / 'scripts/check_owner_container.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class OwnerScanTests(unittest.TestCase):
    def setUp(self):
        self.scan = {'Metadata': {'ImageID': 'synthetic-image', 'OS': {'Family': 'alpine', 'Name': '3.24.2'}},
                     'Results': [{'Type': 'alpine'}, {'Type': 'python-pkg'}]}

    def test_upstream_omits_false_eosl(self):
        module.validate_scan(self.scan, 'synthetic-image')
        self.scan['Metadata']['OS']['EOSL'] = False
        module.validate_scan(self.scan, 'synthetic-image')

    def test_eosl_or_unidentified_os_fails(self):
        for operating_system in [{}, {'Family': 'alpine'}, {'Family': 'unknown', 'Name': '3.24.2'},
                                 {'Family': 'alpine', 'Name': '3.24.2', 'EOSL': True},
                                 {'Family': 'alpine', 'Name': '3.24.2', 'EOSL': 'false'}]:
            with self.subTest(operating_system=operating_system), self.assertRaises(AssertionError):
                scan = copy.deepcopy(self.scan)
                scan['Metadata']['OS'] = operating_system
                module.validate_scan(scan, 'synthetic-image')

    def test_missing_language_os_coverage_and_findings_fail(self):
        for results in [[], [{'Type': 'alpine'}], [{'Type': 'python-pkg'}],
                        [{'Type': 'alpine', 'Vulnerabilities': [{'Severity': 'HIGH'}]}, {'Type': 'python-pkg'}]]:
            with self.subTest(results=results), self.assertRaises(AssertionError):
                module.validate_scan({**self.scan, 'Results': results}, 'synthetic-image')
        with self.assertRaises(AssertionError):
            module.validate_scan(self.scan, 'another-image')
