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


@unittest.skipUnless(os.environ.get("RESEARCH_TEST_DATABASE_URL"), "Requires real isolated PostgreSQL")
class AnnotationSearchTests(unittest.TestCase):
    setUp=OwnerSearchTests.setUp
    search=OwnerSearchTests.search

    def capture(self,body="privateselector observation"):
        from islam_research import passage_store
        with self.db.connect(self.dsn) as connection:
            document=passage_store.create_document(connection,project_id=self.project,source_record_id=self.source,
                edition="Synthetic edition",locator="Abstract",representation_url="",actor="test-owner",
                text="UNSELECTED PRIVATE DOCUMENT "+"x"*100+" tafsīr "+"z"*100)
            start=document["text_body"].index("tafsīr")
            row=passage_store.create_annotation(connection,annotation_uuid=str(uuid.uuid4()),project_id=self.project,
                document_id=document["id"],text_sha256=document["text_sha256"],start=start,end=start+6,exact="tafsīr",
                capture_kind="term_candidate",body=body,actor="test-owner")
        return document,row

    def test_annotation_scope_returns_exact_targets_without_private_document_text(self):
        import json
        document,row=self.capture()
        self.assertEqual(self.search("privateselector")["items"],[])
        self.assertEqual(self.search("privateselector","notes")["items"],[])
        result=self.search("privateselector","annotations")
        self.assertEqual([r["id"] for r in result["items"]],[self.source])
        match=result["items"][0]["matches"][0]
        self.assertEqual(match["channel"],"private_annotation")
        self.assertEqual(match["target_id"],row["id"])
        self.assertEqual(match["document_id"],document["id"])
        self.assertEqual(match["capture_kind"],"term_candidate")
        self.assertEqual(match["review_state"],"captured_unreviewed")
        self.assertEqual(match["revision"],1)
        self.assertNotIn("UNSELECTED PRIVATE DOCUMENT",json.dumps(result))
        self.assertEqual(len(self.search("privateselector","all")["items"]),1)
        self.assertEqual(self.store.search(self.other,"privateselector","annotations",None,30)["items"],[])
        with self.db.connect(self.dsn) as connection:
            self.db.save_record(connection,record_id=self.source,project_id=self.project,kind="source",title="Synthetic source",
                summary="x"*3000,actor="test-owner",expected_revision=1)
        hit=self.search("privateselector","annotations")["items"][0]
        self.assertEqual(len(hit["summary"]),2000)
        self.assertTrue(hit["summary_truncated"])
        with self.db.connect(self.dsn) as connection:
            self.assertEqual(len(self.db.get_record(connection,self.source)["summary"]),3000)

    def test_annotation_matches_are_bounded_and_updated_without_stale_private_results(self):
        from islam_research import passage_store
        rows=[self.capture(f"privateselector observation {i}")[1] for i in range(6)]
        result=self.search("privateselector","annotations")
        self.assertEqual(len(result["items"][0]["matches"]),5)
        self.assertTrue(result["items"][0]["matches_truncated"])
        row=rows[0]
        with self.db.connect(self.dsn) as connection:
            passage_store.update_annotation(connection,annotation_id=row["id"],project_id=self.project,
                body="replacementselector observation",expected_revision=1,actor="test-owner")
        match=self.search("replacementselector","annotations")["items"][0]["matches"][0]
        self.assertEqual(match["target_id"],row["id"])
        self.assertEqual(match["revision"],2)
        with self.db.connect(self.dsn) as connection:
            connection.execute("UPDATE research.records SET deleted_at=clock_timestamp(),revision=revision+1 WHERE id=%s",(self.source,))
        self.assertEqual(self.search("privateselector","all")["items"],[])
