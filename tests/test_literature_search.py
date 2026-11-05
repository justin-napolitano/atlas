import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


MODULE_PATH = Path(__file__).resolve().parents[1] / "scripts" / "literature_search.py"
spec = importlib.util.spec_from_file_location("literature_search", MODULE_PATH)
literature_search = importlib.util.module_from_spec(spec)
spec.loader.exec_module(literature_search)
from islam_research import net as research_net


class ProviderNormalizationTests(unittest.TestCase):
    def test_merge_deduplicates_by_doi_and_keeps_provider_metadata(self):
        records = [
            {"provider": "A", "provider_rank": 1, "doi": "10.example/ABC", "title": "Example", "authors": []},
            {"provider": "B", "provider_rank": 3, "doi": "10.example/abc", "title": "Example", "abstract": "abstract", "license": "CC BY"},
        ]
        merged = literature_search.merge_records(records)
        self.assertEqual(len(merged), 1)
        self.assertEqual(merged[0]["record_id"], "doi:10.example/abc")
        self.assertEqual(merged[0]["abstract"], "abstract")
        self.assertEqual(merged[0]["license"], "CC BY")
        self.assertEqual(merged[0]["providers"], ["A", "B"])

    def test_semantic_scholar_maps_metadata(self):
        response = {"data": [{"paperId": "p1", "title": "Authority", "year": 2020,
            "externalIds": {"DOI": "https://doi.org/10.1/test"}, "authors": [{"name": "A"}],
            "citationCount": 4, "openAccessPdf": {"url": "https://example.test/paper.pdf"}}]}
        with patch.object(literature_search, "fetch_json", return_value=response):
            result = literature_search.semantic_scholar("authority", 5)
        self.assertEqual(result[0]["doi"], "10.1/test")
        self.assertEqual(result[0]["provider_id"], "p1")
        self.assertEqual(result[0]["open_access_url"], "https://example.test/paper.pdf")

    def test_datacite_maps_doi_work_and_license(self):
        response = {"data": [{"id": "10.5281/zenodo.1", "attributes": {
            "doi": "10.5281/zenodo.1", "titles": [{"title": "Dataset"}],
            "publicationYear": 2024, "creators": [{"name": "Researcher"}],
            "rightsList": [{"rights": "CC BY 4.0"}], "url": "https://example.test"}}]}
        with patch.object(literature_search, "fetch_json", return_value=response):
            result = literature_search.datacite("dataset", 5)
        self.assertEqual(result[0]["title"], "Dataset")
        self.assertEqual(result[0]["license"], "CC BY 4.0")

    def test_host_pacing_is_persistent_and_scoped_by_host(self):
        with tempfile.TemporaryDirectory() as folder:
            with patch.object(research_net, "PACE_DB", Path(folder) / "pace.sqlite3"):
                research_net.wait_for_host("https://one.example/a", min_interval=0)
                research_net.wait_for_host("https://two.example/a", min_interval=0)
                import sqlite3
                with sqlite3.connect(research_net.PACE_DB) as db:
                    hosts = {row[0] for row in db.execute("SELECT host FROM host_requests")}
                self.assertEqual(hosts, {"one.example", "two.example"})


if __name__ == "__main__":
    unittest.main()
