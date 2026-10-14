import importlib.util
from pathlib import Path
import tempfile
import unittest

MODULE_PATH = Path(__file__).resolve().parents[1] / "scripts" / "source_search.py"
spec = importlib.util.spec_from_file_location("source_search", MODULE_PATH)
source_search = importlib.util.module_from_spec(spec)
spec.loader.exec_module(source_search)


class LocalSourceSearchTests(unittest.TestCase):
    def test_openiti_finds_passage_and_uses_version_uri(self):
        with tempfile.TemporaryDirectory() as folder:
            corpus = Path(folder)
            author = corpus / "data" / "0310Tabari"
            work = author / "0310Tabari.Tafsir"
            work.mkdir(parents=True)
            text = work / "0310Tabari.Tafsir.Shm001-ara1.mARkdown"
            text.write_text("header\n# Quran text on authority\n", encoding="utf-8")
            text.with_suffix(".yml").write_text("00#VERS#URI######: 0310Tabari.Tafsir.Shm001-ara1\n10#BOOK#TITLEB#AR: Tafsir al-Tabari\n", encoding="utf-8")
            result = next(source_search.openiti_results(corpus, "Quran text", 5))
        self.assertEqual(result["provider_id"], "0310Tabari.Tafsir.Shm001-ara1")
        self.assertEqual(result["title"], "Tafsir al-Tabari")
        self.assertEqual(result["locator"].split(", line ")[1], "2")

    def test_iiif_manifest_search_extracts_stable_identifier(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "manifest.json"
            path.write_text('{"id":"https://example.org/manifest/1","type":"Manifest","label":{"en":["Arabic manuscript"],"ar":["مخطوط"]},"metadata":[{"label":{"en":["Repository"]},"value":{"none":["Library"]}}]}', encoding="utf-8")
            result = source_search.iiif_record(path, "Arabic manuscript")
        self.assertEqual(result["provider_id"], "https://example.org/manifest/1")
        self.assertIn("Repository: Library", result["snippet"])

    def test_fihrist_tei_search_extracts_title_and_shelfmark(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "record.xml"
            path.write_text('<TEI xmlns="http://www.tei-c.org/ns/1.0"><title>Book of Knowledge</title><author>Alim</author><idno type="shelfmark">MS 42</idno></TEI>', encoding="utf-8")
            result = source_search.xml_record(path, "Knowledge")
        self.assertEqual(result["title"], "Book of Knowledge")
        self.assertEqual(result["provider_id"], "MS 42")

    def test_corpus_coranicum_resolver_is_exact_and_does_not_fetch(self):
        candidate = source_search.corpus_coranicum_candidate("4:59")
        self.assertTrue(candidate["landing_page"].endswith("sura/4/verse/59/commentary"))
        with self.assertRaises(ValueError):
            source_search.corpus_coranicum_candidate("authority")


if __name__ == "__main__":
    unittest.main()
