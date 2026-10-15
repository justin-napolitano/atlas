import copy
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

try:
    from islam_research.semantic import load_json, validate_directory, validate_model, validate_policy
except ModuleNotFoundError:
    validate_directory = None

ROOT = Path(__file__).resolve().parents[1] / "semantic"


@unittest.skipUnless(validate_directory, "Install the semantic extra for contract validation")
class SemanticContractTests(unittest.TestCase):
    def setUp(self):
        self.schema = load_json(ROOT / "vendor/apache-ossie/osi-schema.json")
        self.model = load_json(ROOT / "research.ossie.json")
        self.policy = load_json(ROOT.parent / "src/islam_research/policies/research-policy.json")

    def test_pinned_model_validates_offline_and_reports_candidate_status(self):
        result = validate_directory(ROOT)
        self.assertEqual(result["release_status"], "release_candidate")
        self.assertIn("not implemented", result["execution"])

    def test_private_citation_lineage_has_project_scoped_composite_relationships(self):
        content=self.model["semantic_model"][0]
        datasets={row["name"]:row for row in content["datasets"]}
        self.assertIn("scripture_citations",datasets)
        self.assertNotIn("text_body",[row["name"] for row in datasets["reading_documents"]["fields"]])
        for name in ["reading_document_source","reading_annotation_document","scripture_citation_annotation","scripture_citation_document"]:
            relationship=next(row for row in content["relationships"] if row["name"]==name)
            self.assertEqual(relationship["from_columns"][0],"project_id")
            self.assertEqual(relationship["to_columns"][0],"project_id")

    def test_ambiguous_names_and_wrong_composite_grain_are_rejected(self):
        duplicate = copy.deepcopy(self.model)
        model = duplicate["semantic_model"][0]
        model["datasets"].append(copy.deepcopy(model["datasets"][0]))
        with self.assertRaisesRegex(ValueError, "Duplicate dataset"):
            validate_model(duplicate, self.schema)
        changed = copy.deepcopy(self.model)
        changed["semantic_model"][0]["relationships"][1]["to_columns"] = ["id", "project_id"]
        with self.assertRaisesRegex(ValueError, "unique grain"):
            validate_model(changed, self.schema)

    def test_model_sql_is_never_treated_as_a_database_connection_or_query(self):
        changed = copy.deepcopy(self.model)
        changed["semantic_model"][0]["datasets"][0]["source"] = "SELECT * FROM research.personal_states"
        with self.assertRaisesRegex(ValueError, "Unsupported dataset"):
            validate_model(changed, self.schema)

    def test_schema_references_cannot_fetch_remote_resources(self):
        schema = {"$schema": "https://json-schema.org/draft/2020-12/schema", "$ref": "https://example.invalid/never-fetch"}
        with patch("urllib.request.urlopen", side_effect=AssertionError("Network access")) as network:
            with self.assertRaises(Exception):
                validate_model(self.model, schema)
            network.assert_not_called()

    def test_changed_vendored_schema_fails_before_validation(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "semantic"
            shutil.copytree(ROOT, target)
            schema = target / "vendor/apache-ossie/osi-schema.json"
            schema.write_text(schema.read_text() + "\n")
            with self.assertRaisesRegex(ValueError, "content drift"):
                validate_directory(target)

    def test_metadata_link_cannot_replace_an_evidence_step(self):
        changed = copy.deepcopy(self.policy)
        changed["traversal_profiles"][0]["steps"][1]["predicate"] = "https://islam-research.local/vocab/attributedTo"
        with self.assertRaisesRegex(ValueError, "compose"):
            validate_policy(changed)
        changed = copy.deepcopy(self.policy)
        changed["traversal_profiles"][0]["authorization"] = "filter_after_traversal"
        with self.assertRaisesRegex(ValueError, "Unsafe"):
            validate_policy(changed)

    def test_invalid_rank_weights_and_public_personal_profiles_are_rejected(self):
        for weight in [float("nan"), -1, True, 2]:
            changed = copy.deepcopy(self.policy)
            changed["ranking_profiles"][0]["features"][0]["weight"] = weight
            with self.subTest(weight=weight), self.assertRaises(ValueError):
                validate_policy(changed)
        changed = copy.deepcopy(self.policy)
        changed["ranking_profiles"][0]["scope"] = "public"
        with self.assertRaisesRegex(ValueError, "Unsupported"):
            validate_policy(changed)

    def test_reserved_types_and_json_input_are_not_silently_promoted(self):
        changed = copy.deepcopy(self.policy)
        reserved = next(row for row in changed["kind_mappings"] if row["status"] == "reserved")
        reserved["rdf_class"] = "https://example.invalid/UnsupportedHistoricalClaim"
        with self.assertRaisesRegex(ValueError, "reserved"):
            validate_policy(changed)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "model.json"
            path.write_text('{"version":1,"version":2}')
            with self.assertRaisesRegex(ValueError, "Duplicate JSON"):
                load_json(path)
            path.write_text('{"weight":NaN}')
            with self.assertRaisesRegex(ValueError, "Non-finite"):
                load_json(path)
