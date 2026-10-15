"""Search contracts exercise PostgreSQL tokenization/ranking, not mocked SQL."""
import os
import unittest
import uuid


@unittest.skipUnless(os.environ.get("RESEARCH_TEST_DATABASE_URL"), "Requires real isolated PostgreSQL")
class OwnerSearchTests(unittest.TestCase):
    def setUp(self):
        from islam_research import database as db
        from islam_research.api_store import PostgreSQLStore
        self.db = db
        self.dsn = os.environ["RESEARCH_TEST_DATABASE_URL"]
        self.store = PostgreSQLStore(self.dsn)
        self.prefix = "test:" + uuid.uuid4().hex + ":"
        self.project, self.other = self.prefix+"project", self.prefix+"other"
        self.source, self.second, self.private = [self.prefix+i for i in ["a", "b", "c"]]
        with db.connect(self.dsn) as connection:
            db.migrate(connection)
            db.create_project(connection, self.project, "Synthetic search project")
            db.create_project(connection, self.other, "Synthetic other project")
            for identifier, project, title in [(self.source, self.project, "Synthetic authority tafsir"),
                                               (self.second, self.project, "Synthetic authority tafsir"),
                                               (self.private, self.other, "Synthetic authority tafsir")]:
                db.save_record(connection, record_id=identifier, project_id=project, kind="source", title=title,
                    summary="Synthetic exegetical discussion of التفسير", actor="test-owner")
            db.save_personal_state(connection, record_id=self.source, project_id=self.project, actor="test-owner",
                note="Synthetic privateterm authority observation", reading="reading")

    def search(self, query, scope="records", kind=None, limit=30):
        return self.store.search(self.project, query, scope, kind, limit)

    def test_notes_require_scope_and_matches_expose_revision_and_channel(self):
        self.assertEqual(self.search("privateterm")["items"], [])
        result = self.search("privateterm", "notes")
        self.assertEqual([r["id"] for r in result["items"]], [self.source])
        match = result["items"][0]["matches"][0]
        self.assertEqual(match["channel"], "private_note")
        self.assertEqual(match["revision"], 1)
        self.assertIn("privateterm", match["excerpt"])
        result = self.search("authority", "all")
        source = next(r for r in result["items"] if r["id"] == self.source)
        self.assertEqual({m["channel"] for m in source["matches"]}, {"record", "private_note"})
        self.assertNotIn("privateterm", self.search("authority")["items"][0]["matches"][0]["excerpt"])

    def test_project_kind_limits_and_stable_ties_are_enforced(self):
        result = self.search("authority")
        self.assertEqual([r["id"] for r in result["items"]], [self.source, self.second])
        self.assertNotIn(self.private, [r["id"] for r in result["items"]])
        self.assertTrue(all(0 <= r["score"] <= 1 for r in result["items"]))
        self.assertEqual(self.search("authority", kind="question")["items"], [])
        self.assertTrue(self.search("authority", limit=1)["truncated"])
        self.assertEqual(len(self.search("authority", limit=1)["items"]), 1)

    def test_unicode_literal_queries_and_immediate_note_updates(self):
        self.assertEqual(len(self.search("التفسير")["items"]), 2)
        self.assertEqual(len(self.search("TAFSIR")["items"]), 2)
        self.assertEqual(self.search("authority' OR true --")["items"], [])
        self.assertEqual(self.search("!!!")["items"], [])
        with self.db.connect(self.dsn) as connection:
            self.db.save_personal_state(connection, record_id=self.source, project_id=self.project, actor="test-owner",
                note="Synthetic replacementterm observation", expected_revision=1)
        self.assertEqual(self.search("privateterm", "notes")["items"], [])
        result = self.search("replacementterm", "notes")
        self.assertEqual(result["items"][0]["matches"][0]["revision"], 2)

    def test_deleted_records_exclude_their_notes_and_invalid_scope_fails(self):
        with self.db.connect(self.dsn) as connection:
            connection.execute("UPDATE research.records SET deleted_at=clock_timestamp(),revision=revision+1 WHERE id=%s", (self.source,))
        self.assertEqual(self.search("privateterm", "notes")["items"], [])
        self.assertEqual([r["id"] for r in self.search("authority")["items"]], [self.second])
        for query, scope, limit in [(" ", "records", 30), ("authority", "arbitrary", 30), ("authority", "all", 101)]:
            with self.assertRaises(ValueError):
                self.search(query, scope=scope, limit=limit)
