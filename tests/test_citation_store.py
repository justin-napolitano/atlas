import os
from pathlib import Path
import re
import unittest
import uuid

from islam_research.quran_citations import AYAH_COUNTS


class CitationMigrationProfileTests(unittest.TestCase):
    def test_immutable_sql_profile_matches_attributed_packaged_structure(self):
        text = (Path(__file__).parents[1]/"src/islam_research/migrations/0007_private_scripture_citations.sql").read_text()
        counts = re.search(r"counts integer\[\] := ARRAY\[([\d,]+)\]", text)[1]
        self.assertEqual(tuple(map(int, counts.split(","))), AYAH_COUNTS)


@unittest.skipUnless(os.environ.get("RESEARCH_TEST_DATABASE_URL"), "Requires real isolated PostgreSQL")
class CitationStoreTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from islam_research import database as db, citation_store, passage_store
        from islam_research.sql_permissions import configure
        from psycopg import sql
        from psycopg.conninfo import make_conninfo
        cls.db, cls.store, cls.passages, cls.sql = db, citation_store, passage_store, sql
        cls.dsn = os.environ["RESEARCH_TEST_DATABASE_URL"]
        cls.owner, cls.publisher = "cite_owner_"+uuid.uuid4().hex, "cite_reader_"+uuid.uuid4().hex
        with db.connect(cls.dsn) as connection:
            db.migrate(connection)
            for role in (cls.owner, cls.publisher):
                connection.execute(sql.SQL("CREATE ROLE {} LOGIN").format(sql.Identifier(role)))
            connection.commit()
            configure(connection,cls.owner,cls.publisher,apply=True)
        cls.owner_dsn = make_conninfo(cls.dsn,user=cls.owner)
        cls.publisher_dsn = make_conninfo(cls.dsn,user=cls.publisher)

    @classmethod
    def tearDownClass(cls):
        with cls.db.connect(cls.dsn) as connection:
            for role in (cls.owner, cls.publisher):
                connection.execute(cls.sql.SQL("DROP OWNED BY {}").format(cls.sql.Identifier(role)))
                connection.execute(cls.sql.SQL("DROP ROLE {}").format(cls.sql.Identifier(role)))

    def setUp(self):
        self.project, self.source = "test:"+uuid.uuid4().hex, "test:"+uuid.uuid4().hex
        with self.db.connect(self.owner_dsn) as connection:
            self.db.create_project(connection,self.project,"Synthetic citation project")
            self.db.save_record(connection,record_id=self.source,project_id=self.project,kind="source",title="Synthetic source",actor="test-owner")
            text = "😀 PRIVATE OUTSIDE SELECTION. Read Q 4:59 and 83. More outside text."
            self.document = self.passages.create_document(connection,project_id=self.project,source_record_id=self.source,
                edition="Synthetic edition",locator="Abstract, sentence 2",representation_url="https://example.invalid/source",text=text,actor="test-owner")
            selected = "Q 4:59 and 83"
            self.annotation = self.passages.create_annotation(connection,annotation_uuid=str(uuid.uuid4()),project_id=self.project,
                document_id=self.document["id"],text_sha256=self.document["text_sha256"],start=text.index(selected),
                end=text.index(selected)+len(selected),exact=selected,capture_kind="citation_candidate",body="Private note",actor="test-owner")
            self.candidate = self.store.candidates(connection,self.project,self.annotation["id"])["candidates"][0]

    def resolve(self, connection, **patch):
        return self.store.resolve(connection,**{**dict(project_id=self.project,annotation_id=self.annotation["id"],
            candidate_key=self.candidate["key"],decision="confirmed",chapter=4,ayah_start=59,ayah_end=59,
            rationale="Owner resolved an explicit numeric citation; interpretation unreviewed",expected_revision=0,actor="test-owner"),**patch})

    def test_restricted_owner_confirmation_retry_correction_conflict_and_history(self):
        with self.db.connect(self.owner_dsn) as connection:
            row = self.resolve(connection)
            self.assertEqual(row,self.resolve(connection))
            self.assertEqual(row["document_id"],self.document["id"])
            self.assertEqual(row["text_sha256"],self.document["text_sha256"])
            self.assertEqual(row["matched_text"],"Q 4:59")
            revised = self.resolve(connection,expected_revision=1,ayah_start=60,ayah_end=60,rationale="Synthetic correction")
            self.assertEqual(revised["revision"],2)
            self.assertEqual(revised,self.resolve(connection,expected_revision=1,ayah_start=60,ayah_end=60,rationale="Synthetic correction"))
            self.assertEqual(revised["proposal"],row["proposal"])
            with self.assertRaises(self.db.RevisionConflict):
                self.resolve(connection,expected_revision=1,rationale="Stale conflicting edit")
            self.assertEqual(connection.execute("SELECT count(*) AS n FROM research.scripture_citation_revisions WHERE citation_id=%s",(row["id"],)).fetchone()["n"],2)
            self.assertEqual(connection.execute("SELECT review_state FROM research.records WHERE id=%s",(self.source,)).fetchone()["review_state"],"pending")

    def test_manual_mapping_dismissal_and_reverse_lookup_keep_source_location(self):
        with self.db.connect(self.owner_dsn) as connection:
            row = self.resolve(connection,candidate_key="manual",ayah_start=59,ayah_end=83,rationale="Owner mapping, not an explicit citation claim")
            self.assertEqual(row["detector_kind"],"owner_mapping")
            found = self.store.for_verse(connection,self.project,4,83,83,"",26)
            self.assertEqual(len(found),1)
            self.assertEqual(found[0]["source_record_id"],self.source)
            self.assertEqual(found[0]["edition"],"Synthetic edition")
            self.assertEqual(found[0]["selected_quote"],self.annotation["exact"])
            self.assertEqual(self.store.for_verse(connection,"other",4,83,83,"",26),[])
            self.resolve(connection,candidate_key="manual",expected_revision=1,decision="dismissed",chapter=None,ayah_start=None,ayah_end=None)
            self.assertEqual(self.store.for_verse(connection,self.project,4,59,83,"",26),[])

    def test_unknown_candidate_wrong_project_and_invalid_bounds_do_not_write(self):
        with self.db.connect(self.owner_dsn) as connection:
            for patch in [{"candidate_key":"a"*64},{"project_id":"other"},{"chapter":115},{"ayah_start":177,"ayah_end":177},
                          {"chapter":True},{"decision":"dismissed"},{"rationale":" "},{"expected_revision":True}]:
                with self.assertRaises(ValueError):
                    self.resolve(connection,**patch)
            self.assertIsNone(self.store.candidates(connection,"other",self.annotation["id"]))
            self.assertEqual(self.store.candidates(connection,self.project,self.annotation["id"])["resolutions"],[])

    def test_sql_rejects_forged_anchors_bounds_and_history_mutation(self):
        from psycopg.errors import CheckViolation, InsufficientPrivilege
        with self.db.connect(self.owner_dsn) as connection:
            row = self.resolve(connection)
            for assignment in ["chapter=115,revision=revision+1", "ayah_end=177,revision=revision+1", "revision=revision+2"]:
                with self.assertRaises(CheckViolation):
                    with connection.transaction():
                        connection.execute("UPDATE research.scripture_citations SET "+assignment+" WHERE id=%s",(row["id"],))
            for query in ["UPDATE research.scripture_citations SET matched_text='forged' WHERE id=%s",
                          "DELETE FROM research.scripture_citations WHERE id=%s",
                          "DELETE FROM research.scripture_citation_revisions WHERE citation_id=%s"]:
                with self.assertRaises(InsufficientPrivilege):
                    with connection.transaction():
                        connection.execute(query,(row["id"],))
        # Schema-owner test exercises trigger protections independently of grants.
        with self.db.connect(self.dsn) as connection:
            with self.assertRaises(CheckViolation):
                with connection.transaction():
                    connection.execute("UPDATE research.scripture_citations SET matched_text='forged',revision=revision+1 WHERE id=%s",(row["id"],))
        with self.db.connect(self.publisher_dsn) as connection:
            for table in ["scripture_citations","scripture_citation_revisions"]:
                with self.assertRaises(InsufficientPrivilege):
                    with connection.transaction():
                        connection.execute("SELECT * FROM research."+table)

    def test_private_annotation_export_retains_resolution_and_excludes_full_excerpt(self):
        from islam_research.api_store import PostgreSQLStore
        import json
        with self.db.connect(self.owner_dsn) as connection:
            row = self.resolve(connection)
        exported = PostgreSQLStore(self.owner_dsn).reading_annotation(self.project,self.annotation["id"])["web_annotation"]
        self.assertEqual(exported["ir:scriptureReferences"][0]["id"],row["id"])
        self.assertEqual(exported["ir:scriptureReferences"][0]["revision"],1)
        self.assertEqual(exported["ir:edition"],"Synthetic edition")
        self.assertNotIn("PRIVATE OUTSIDE SELECTION",json.dumps(exported,default=str))
