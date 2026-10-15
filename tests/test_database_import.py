import os
import tempfile
import unittest
import uuid
from pathlib import Path

try:
    from islam_research.database_import import import_turtle, plan_turtle
    from islam_research import database as db
except ModuleNotFoundError:
    if os.environ.get("RESEARCH_TEST_DATABASE_URL"):
        raise
    db = None

ROOT = Path(__file__).resolve().parents[1]
GRAPH = ROOT / "graph/research.ttl"


@unittest.skipUnless(db, "Install graph and database extras for import contract checks")
class ImportPlanTests(unittest.TestCase):
    def test_plan_preserves_graph_ids_and_does_not_promote_review(self):
        plan = plan_turtle(GRAPH)
        self.assertEqual(len(plan["records"]), 25)
        self.assertEqual(len(plan["relations"]), 44)
        source = next(r for r in plan["records"] if r["id"].endswith("/sirry-2021-ulul-amr"))
        self.assertIn("full argument requires section-level review", source["attributes"]["recorded_review_status"][0])
        self.assertEqual(plan["original_text"], GRAPH.read_text(encoding="utf-8"))
        self.assertEqual(plan["sha256"], plan_turtle(GRAPH)["sha256"])


@unittest.skipUnless(os.environ.get("RESEARCH_TEST_DATABASE_URL"), "Requires isolated PostgreSQL")
class ImportDatabaseTests(unittest.TestCase):
    def test_preview_atomic_import_retry_and_exact_export(self):
        with db.connect(os.environ["RESEARCH_TEST_DATABASE_URL"]) as connection:
            db.migrate(connection)
            project = "test:" + str(uuid.uuid4())
            db.create_project(connection, project, "Synthetic import project")
            preview = import_turtle(connection, GRAPH, project, actor="test-owner")
            self.assertTrue(preview["dry_run"])
            self.assertEqual(connection.execute("SELECT count(*) AS n FROM research.records WHERE project_id=%s", (project,)).fetchone()["n"], 0)
            applied = import_turtle(connection, GRAPH, project, actor="test-owner", dry_run=False)
            repeated = import_turtle(connection, GRAPH, project, actor="test-owner", dry_run=False)
            self.assertTrue(repeated["already_imported"])
            snapshot = connection.execute("SELECT * FROM research.import_snapshots WHERE project_id=%s", (project,)).fetchone()
            self.assertEqual(snapshot["original_text"], GRAPH.read_text(encoding="utf-8"))
            self.assertEqual((snapshot["record_count"], snapshot["relation_count"]), (25, 44))
            source = "https://islam-research.local/id/sirry-2021-ulul-amr"
            with self.assertRaises(db.RevisionConflict):
                db.save_record(connection, record_id=source, project_id=project, kind="source",
                               title="Attempted overwrite", actor="test-owner", expected_revision=1)
            self.assertEqual(db.get_record(connection, source)["origin"], "canonical_rdf")
            with tempfile.TemporaryDirectory() as directory:
                changed = Path(directory) / "changed.ttl"
                changed.write_text(GRAPH.read_text(encoding="utf-8") + "\n# Synthetic changed snapshot\n")
                with self.assertRaisesRegex(ValueError, "reconciliation"):
                    import_turtle(connection, changed, project, actor="test-owner", dry_run=False)
            self.assertEqual(applied["sha256"], repeated["sha256"])
