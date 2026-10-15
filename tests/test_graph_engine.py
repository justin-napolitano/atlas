import json
import os
import unittest
import uuid
import subprocess
import sys
from pathlib import Path

try:
    from islam_research.graph_engine import rank, registered_policy, traverse
except ModuleNotFoundError:
    if os.environ.get("RESEARCH_TEST_DATABASE_URL"):
        raise
    registered_policy = None

IR = "https://islam-research.local/vocab/"


def node(identifier, kind, project="p"):
    return dict(id=identifier, kind=kind, project_id=project, title=identifier,
                summary="Synthetic test record", revision=1, review_state="pending")


def edge(identifier, source, predicate, target):
    return dict(id=identifier, project_id=source["project_id"], from_id=source["id"], to_id=target["id"],
                predicate=IR + predicate, source=source, target=target,
                provenance={"activity": "synthetic fixture"}, review_state="pending")


@unittest.skipUnless(registered_policy, "Install semantic extra for registered operations")
class GraphEngineTests(unittest.TestCase):
    def setUp(self):
        self.q, self.c, self.e, self.s = [node(i, k) for i, k in
            [("q", "question"), ("c", "claim"), ("e", "evidence"), ("s", "source")]]
        self.edges = [edge("1", self.c, "addressesQuestion", self.q),
                      edge("2", self.c, "evidence", self.e), edge("3", self.e, "source", self.s)]

    def provider(self, frontier, step, predicate, limit):
        column = "from_id" if step["direction"] == "out" else "to_id"
        return sorted([e for e in self.edges if e[column] in frontier and e["predicate"] == step["predicate"]],
                      key=lambda e: e["id"])[:limit]

    def test_complete_evidence_paths_preserve_direction_and_review(self):
        result = traverse(self.q, "p", "question_evidence_trail", self.provider)
        self.assertEqual(result["paths"], [{"records": ["q", "c", "e", "s"], "edges": ["1", "2", "3"]}])
        self.assertFalse(result["truncated"])
        self.assertEqual(result["edges"][0]["from_id"], "c")
        self.assertTrue(all(e["review_state"] == "pending" and e["provenance"] for e in result["edges"]))
        self.assertEqual(len(result["policy_sha256"]), 64)

    def test_unknown_profile_wrong_kind_and_outside_project_fail(self):
        for start, project, profile in [(self.q, "p", "arbitrary_sql"), (self.s, "p", "question_evidence_trail"),
                                        (self.q, "other", "question_evidence_trail")]:
            with self.assertRaises(ValueError):
                traverse(start, project, profile, self.provider)

    def test_missing_evidence_is_not_reported_as_a_complete_argument(self):
        self.edges.pop()
        result = traverse(self.q, "p", "question_evidence_trail", self.provider)
        self.assertEqual(result["paths"], [])
        self.assertEqual(result["status"], "no_complete_path_in_selected_graph")
        self.assertFalse(result["truncated"])

    def test_provider_cannot_leak_another_project_deleted_or_wrong_kind(self):
        for change in [("project_id", "another-project"), ("deleted_at", "synthetic deletion"), ("kind", "person")]:
            self.setUp()
            self.edges[0]["source"][change[0]] = change[1]
            with self.assertRaises(ValueError):
                traverse(self.q, "p", "question_evidence_trail", self.provider)

    def test_limits_mark_truncation_and_never_overflow(self):
        policy, _ = registered_policy()
        profile = policy["traversal_profiles"][0]
        profile["max_nodes"] = 2
        result = traverse(self.q, "p", profile["id"], self.provider, policy=policy)
        self.assertTrue(result["truncated"])
        self.assertLessEqual(len(result["nodes"]), 2)
        self.assertEqual(result["paths"], [])
        profile["max_nodes"], profile["max_edges"] = 200, 1
        result = traverse(self.q, "p", profile["id"], self.provider, policy=policy)
        self.assertTrue(result["truncated"])
        self.assertLessEqual(len(result["edges"]), 1)

    def test_simple_paths_do_not_revisit_nodes(self):
        policy, _ = registered_policy()
        profile = policy["traversal_profiles"][0]
        profile.update(id="synthetic_cycle", start_kinds=["concept"], end_kinds=["concept"], max_depth=2,
                       steps=[dict(predicate=IR+"related", direction="out")]*2)
        policy["predicates"].append(dict(iri=IR+"related", from_kinds=["concept"], to_kinds=["concept"], meaning="Synthetic relation"))
        a, b = node("a", "concept"), node("b", "concept")
        self.edges = [edge("1", a, "related", b), edge("2", b, "related", a)]
        self.assertEqual(traverse(a, "p", "synthetic_cycle", self.provider, policy=policy)["paths"], [])

    def test_rank_explains_weights_and_preserves_unknown_values(self):
        candidates = [{"id": i, "features": {"query_match": {"value": value, "basis": "Synthetic declared match"},
                       "scope_match": {"value": 1, "basis": "Synthetic declared scope"}}} for i, value in [("b", 1), ("a", 1), ("c", 0)]]
        candidates.append({"id": "unknown", "features": {}})
        result = rank("discovery_relevance", candidates)
        self.assertEqual([r["id"] for r in result["items"]], ["a", "b", "c", "unknown"])
        self.assertEqual(result["items"][0]["score"], 1)
        self.assertIsNone(result["items"][-1]["score"])
        self.assertEqual(result["items"][-1]["missing"], ["query_match", "scope_match"])
        self.assertEqual(result["items"][0]["terms"][0]["weight"], .7)
        self.assertIn("not source quality", result["meaning"])

    def test_invalid_rank_values_unknown_features_and_duplicate_ids_fail(self):
        for value in [True, float("nan"), float("inf"), -1, 2, "1"]:
            with self.assertRaises(ValueError):
                rank("graph_degree", [{"id": "a", "features": {"normalized_degree": {"value": value, "basis": "Synthetic"}}}])
        for candidates in [[{"id": "a", "features": {"citation_count": {"value": 1}}}],
                           [{"id": "a", "features": {"normalized_degree": {"value": 1}}}],
                           [{"id": "a", "features": {}}]*2]:
            with self.assertRaises(ValueError):
                rank("graph_degree", candidates)

    def test_local_pilot_has_three_located_source_trails_without_mutation(self):
        root = Path(__file__).resolve().parents[1]
        graph = root / "graph/research.ttl"
        before = graph.read_bytes()
        completed = subprocess.run([sys.executable, str(root / "scripts/explore_graph.py"),
            "--start", "https://islam-research.local/id/pilot-question"], capture_output=True, text=True, check=True)
        result = json.loads(completed.stdout)
        self.assertEqual(len(result["paths"]), 3)
        self.assertEqual(len(result["nodes"]), 10)
        self.assertFalse(result["truncated"])
        self.assertEqual({p["records"][-1].split("/")[-1] for p in result["paths"]},
                         {"sirry-2021-ulul-amr", "tabari-tafsir-4-59", "tabatabai-almizan-4-59"})
        self.assertEqual(graph.read_bytes(), before)


@unittest.skipUnless(os.environ.get("RESEARCH_TEST_DATABASE_URL"), "Requires real isolated PostgreSQL")
class GraphDatabaseTests(unittest.TestCase):
    def test_typed_database_paths_and_tombstones_with_project_filtering(self):
        from islam_research import database as db
        from islam_research.api_store import PostgreSQLStore
        from psycopg.types.json import Jsonb
        dsn = os.environ["RESEARCH_TEST_DATABASE_URL"]
        prefix = "test:" + uuid.uuid4().hex + ":"
        project = prefix + "project"
        records = [node(prefix+i, k, project) for i, k in [("q", "question"), ("c", "claim"), ("e", "evidence"), ("s", "source")]]
        with db.connect(dsn) as connection:
            db.migrate(connection)
            db.create_project(connection, project, "Synthetic traversal project")
            for record in records:
                db.save_record(connection, record_id=record["id"], project_id=project, kind=record["kind"], title=record["title"], actor="test-owner")
            for identifier, source, predicate, target in [("1", records[1], "addressesQuestion", records[0]),
                         ("2", records[1], "evidence", records[2]), ("3", records[2], "source", records[3])]:
                connection.execute("INSERT INTO research.relation_types(predicate,description) VALUES (%s,'Synthetic fixture') ON CONFLICT DO NOTHING", (IR+predicate,))
                connection.execute("INSERT INTO research.relations(id,project_id,from_id,predicate,to_id,provenance) VALUES (%s,%s,%s,%s,%s,%s)",
                    (prefix+identifier, project, source["id"], IR+predicate, target["id"], Jsonb({"activity": "synthetic test"})))
        store = PostgreSQLStore(dsn)
        result = store.evidence_path(project, records[0]["id"], "question_evidence_trail")
        self.assertEqual(len(result["paths"]), 1)
        self.assertEqual(result["paths"][0]["records"], [r["id"] for r in records])
        self.assertIsNone(store.evidence_path("other-project", records[0]["id"], "question_evidence_trail"))
        with db.connect(dsn) as connection:
            connection.execute("UPDATE research.records SET deleted_at=clock_timestamp(),revision=revision+1 WHERE id=%s", (records[-1]["id"],))
        result = store.evidence_path(project, records[0]["id"], "question_evidence_trail")
        self.assertEqual(result["paths"], [])
        self.assertNotIn(records[-1]["id"], [n["id"] for n in result["nodes"]])
