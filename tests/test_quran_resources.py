import hashlib
import importlib.util
import json
from pathlib import Path
import unittest
from unittest.mock import patch

from islam_research.quran_citations import AYAH_COUNTS
from islam_research.quran_resources import pilot_resource

ROOT = Path(__file__).parents[1]
spec = importlib.util.spec_from_file_location("extract_pilot", ROOT / "scripts/extract_quran_pilot.py")
extractor = importlib.util.module_from_spec(spec)
spec.loader.exec_module(extractor)


class QuranResourceTests(unittest.TestCase):
    def test_attribution_exact_unicode_checksums_and_separate_reference_identity(self):
        value = pilot_resource()
        self.assertEqual([(v["chapter"], v["ayah_start"]) for v in value["verses"]], [(4, 59), (4, 83)])
        for row in value["verses"]:
            self.assertEqual(hashlib.sha256(row["text"].encode()).hexdigest(), row["text_sha256"])
            self.assertLessEqual(len(row["text"]), 500)
            self.assertIn("tanzil-structure-1.0", row["reference"]["id"])
            self.assertNotIn(value["resource_id"], row["reference"]["id"])
        self.assertIn("Tanzil Quran Text (Uthmani, Version 1.1)", value["source_notice"])
        self.assertIn("copyright notice", value["source_notice"].lower())
        self.assertEqual(value["attribution_url"], "https://tanzil.net/")
        self.assertIn("no independent scholarly review", value["review_limit"])
        value["verses"][0]["text"] = "caller mutation"
        self.assertNotEqual(pilot_resource()["verses"][0]["text"], "caller mutation")

    def test_packaged_byte_change_fails_closed(self):
        with patch("islam_research.quran_resources.PILOT_SHA256", "0" * 64):
            with self.assertRaisesRegex(ValueError, "resource changed"):
                pilot_resource()

    def fixture(self):
        notice = "# Tanzil Quran Text (Uthmani, Version 1.1)\r\n# Synthetic copyright notice\r\n"
        lines = [f"{chapter}|{ayah}|تَفْسِيرٌ\r\n" for chapter, count in enumerate(AYAH_COUNTS, 1) for ayah in range(1, count + 1)]
        return ("".join(lines) + notice).encode()

    def test_extractor_preserves_text_and_complete_notice_and_validates_all_markers(self):
        raw = self.fixture()
        with patch.object(extractor, "SOURCE_SHA256", hashlib.sha256(raw).hexdigest()):
            result = extractor.extract(raw, "2026-10-15")
        self.assertEqual(result["verses"][0]["text"], "تَفْسِيرٌ")
        self.assertTrue(result["source_notice"].endswith("# Synthetic copyright notice\r\n"))
        self.assertEqual(result["source_sha256"], hashlib.sha256(raw).hexdigest())
        for changed in [raw.replace(b"4|59|", b"4|60|"), raw.replace(b"4|83|", b"4|177|")]:
            with patch.object(extractor, "SOURCE_SHA256", hashlib.sha256(changed).hexdigest()):
                with self.assertRaises(ValueError):
                    extractor.extract(changed, "2026-10-15")

    def test_unpinned_download_and_bad_access_date_are_rejected(self):
        with self.assertRaisesRegex(ValueError, "Upstream bytes changed"):
            extractor.extract(self.fixture(), "2026-10-15")
        with self.assertRaises(ValueError):
            extractor.extract(self.fixture(), "not a date")

    def test_local_original_reproduces_packaged_extraction_when_available(self):
        original = ROOT / "research-library/reference-texts/tanzil-uthmani-numbered-1.1.txt"
        if not original.exists():
            self.skipTest("Full upstream download deliberately excluded from repository")
        expected = json.loads((ROOT / "src/islam_research/resources/quran-pilot-v1.json").read_text())
        self.assertEqual(extractor.extract(original.read_bytes(), "2026-10-15"), expected)
