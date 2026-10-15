import os
import unittest
import uuid


@unittest.skipUnless(os.environ.get("RESEARCH_TEST_DATABASE_URL"),"Requires real isolated PostgreSQL")
class ReadingDeskTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from islam_research import database as db,reading_desk,passage_store
        from islam_research.sql_permissions import configure
        from psycopg import sql
        from psycopg.conninfo import make_conninfo
        cls.db,cls.store,cls.passages,cls.sql=db,reading_desk,passage_store,sql
        cls.dsn=os.environ["RESEARCH_TEST_DATABASE_URL"]
        cls.owner="desk_owner_"+uuid.uuid4().hex;cls.publisher="desk_reader_"+uuid.uuid4().hex
        with db.connect(cls.dsn) as connection:
            db.migrate(connection)
            for role in (cls.owner,cls.publisher): connection.execute(sql.SQL("CREATE ROLE {} LOGIN").format(sql.Identifier(role)))
            connection.commit();configure(connection,cls.owner,cls.publisher,apply=True)
        cls.owner_dsn=make_conninfo(cls.dsn,user=cls.owner);cls.publisher_dsn=make_conninfo(cls.dsn,user=cls.publisher)

    @classmethod
    def tearDownClass(cls):
        with cls.db.connect(cls.dsn) as connection:
            for role in (cls.owner,cls.publisher):
                connection.execute(cls.sql.SQL("DROP OWNED BY {}").format(cls.sql.Identifier(role)))
                connection.execute(cls.sql.SQL("DROP ROLE {}").format(cls.sql.Identifier(role)))

    def setUp(self):
        self.project="test:"+uuid.uuid4().hex;self.source="test:"+uuid.uuid4().hex
        with self.db.connect(self.owner_dsn) as connection:
            self.db.create_project(connection,self.project,"Synthetic reading desk")
            self.db.save_record(connection,record_id=self.source,project_id=self.project,kind="source",title="Synthetic source",actor="owner")
            self.document=self.passages.create_document(connection,project_id=self.project,source_record_id=self.source,edition="Synthetic edition",locator="Paragraph 1",
                representation_url="",text="😀 tafsīr and evidence",actor="owner")
            self.annotation=self.passages.create_annotation(connection,annotation_uuid=str(uuid.uuid4()),project_id=self.project,document_id=self.document["id"],
                text_sha256=self.document["text_sha256"],start=2,end=8,exact="tafsīr",capture_kind="comment",body="Private note",actor="owner")

    def save(self,connection,**patch):
        return self.store.save(connection,**{**dict(project_id=self.project,record_id=self.source,document_id=self.document["id"],annotation_id=self.annotation["id"],
            start=None,end=None,expected_revision=0,actor="owner"),**patch})

    def test_two_real_connections_resume_exact_source_and_preserve_lost_reply_history(self):
        with self.db.connect(self.owner_dsn) as connection:
            first=self.save(connection)
            self.assertEqual(first,self.save(connection))
            self.assertEqual((first["start_pos"],first["end_pos"]),(2,8))
        with self.db.connect(self.owner_dsn) as second:
            loaded=self.store.get(second,self.project)
            self.assertEqual(loaded,first)
            self.assertEqual(loaded["text_sha256"],self.document["text_sha256"])
            self.assertEqual(loaded["edition"],"Synthetic edition")
            revised=self.save(second,expected_revision=1,annotation_id=None,start=0,end=0)
            self.assertEqual(revised["revision"],2)
            self.assertEqual(revised,self.save(second,expected_revision=1,annotation_id=None,start=0,end=0))
            with self.assertRaises(self.db.RevisionConflict): self.save(second,expected_revision=1)
            history=self.store.history(second,self.project,None,1)
            self.assertEqual(history[0]["revision"],2)
            self.assertEqual(self.store.history(second,self.project,2,2)[0]["snapshot"]["annotation_id"],self.annotation["id"])
            self.assertEqual(second.execute("SELECT count(*) AS n FROM research.reading_desk_revisions WHERE project_id=%s",(self.project,)).fetchone()["n"],2)
            self.assertIsNone(self.store.get(second,"other"));self.assertIsNone(self.store.history(second,"other",None,25))
            # Position updates do not write a new note or change reading/review.
            self.assertEqual(self.passages.annotation(second,self.project,self.annotation["id"])["annotation"]["revision"],1)

    def test_foreign_document_annotation_and_invalid_position_do_not_save(self):
        with self.db.connect(self.owner_dsn) as connection:
            other=self.db.save_record(connection,record_id="test:"+uuid.uuid4().hex,project_id=self.project,kind="source",title="Other source",actor="owner")
            for patch in [{"record_id":other["id"]},{"project_id":"other"},{"document_id":None},{"start":0,"end":1},
                          {"annotation_id":None,"start":True,"end":4},{"annotation_id":None,"start":0,"end":99999},
                          {"annotation_id":None,"start":2,"end":1},{"expected_revision":True}]:
                with self.subTest(patch=patch):
                    with self.assertRaises(ValueError): self.save(connection,**patch)
            self.assertIsNone(self.store.get(connection,self.project))
            source_only=self.save(connection,document_id=None,annotation_id=None)
            self.assertIsNone(source_only["start_pos"])

    def test_simultaneous_different_initial_positions_preserve_one_winner_and_one_conflict(self):
        from concurrent.futures import ThreadPoolExecutor
        import threading
        barrier=threading.Barrier(2)
        def attempt(use_annotation):
            with self.db.connect(self.owner_dsn) as connection:
                barrier.wait(timeout=10)
                try:
                    return ("saved",self.save(connection,annotation_id=self.annotation["id"] if use_annotation else None))
                except self.db.RevisionConflict as error:
                    return ("conflict",error.current)
        with ThreadPoolExecutor(max_workers=2) as executor:
            results=list(executor.map(attempt,[True,False]))
        self.assertEqual(sorted(r[0] for r in results),["conflict","saved"])
        self.assertEqual(results[0][1]["revision"],1)
        self.assertEqual(results[0][1],results[1][1])
        with self.db.connect(self.owner_dsn) as connection:
            self.assertEqual(len(self.store.history(connection,self.project,None,25)),1)

    def test_sql_enforces_source_selector_revision_and_private_history(self):
        from psycopg.errors import CheckViolation,InsufficientPrivilege
        with self.db.connect(self.owner_dsn) as connection:
            self.save(connection)
            for update in ["start_pos=0,revision=revision+1","end_pos=99999,revision=revision+1","revision=revision+2"]:
                with self.assertRaises(CheckViolation):
                    with connection.transaction(): connection.execute("UPDATE research.reading_desks SET "+update+" WHERE project_id=%s",(self.project,))
            for table in ["reading_desks","reading_desk_revisions"]:
                with self.assertRaises(InsufficientPrivilege):
                    with connection.transaction(): connection.execute("DELETE FROM research."+table+" WHERE project_id=%s",(self.project,))
        with self.db.connect(self.publisher_dsn) as connection:
            for table in ["reading_desks","reading_desk_revisions"]:
                with self.assertRaises(InsufficientPrivilege):
                    with connection.transaction(): connection.execute("SELECT * FROM research."+table)

    def test_published_source_does_not_include_private_reading_place_or_note(self):
        import json
        from islam_research import publication
        with self.db.connect(self.owner_dsn) as connection:
            self.save(connection)
            preview=publication.preview(connection,project_id=self.project,selections=[{"record_id":self.source,"include_summary":True,"include_bibliography":True}],relation_ids=[],actor="owner")
            payload=json.dumps(preview["payload"],default=str)
            for private in [self.annotation["id"],self.document["id"],self.document["text_sha256"],"Private note"]:
                self.assertNotIn(private,payload)
