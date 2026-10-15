from concurrent.futures import ThreadPoolExecutor
import os
import unittest
import uuid


def payload(project="synthetic", **patch):
    return {**dict(intake_uuid=str(uuid.uuid4()),project_id=project,title="Synthetic reading source",
        creators="Synthetic author",publication="Synthetic publication",publication_date="2026",language="English",accessed_on="2026-10-15",edition="Synthetic edition",
        identifier="doi:10.1234/synthetic",source_url="https://example.invalid/article",source_role="scholarship",
        access_status="unknown",rights_status="metadata_only",rights_basis="",coverage_scope="metadata_only",
        rationale="Investigate the bounded pilot question",distinct_source_rationale="",existing_source_record_id=None,
        excerpt=None,owner_confirmed=True,actor="synthetic-owner"),**patch}


class SourceIntakeValidationTests(unittest.TestCase):
    def test_conservative_identity_hints_and_reject_unsafe_urls(self):
        from islam_research.source_intake import identity_keys,validate
        self.assertEqual(identity_keys("https://EXAMPLE.invalid/A?q=X#section","https://doi.org/10.1234/Test"),
                         ("https://example.invalid/A?q=X","doi:10.1234/test"))
        for value in ("file:///etc/passwd","https://user:password@example.invalid","https://example.invalid/\nprivate","https://example.invalid:99999"):
            with self.subTest(url=value),self.assertRaises(ValueError): identity_keys(value,"")
        for patch in (dict(owner_confirmed=1),dict(intake_uuid=str(uuid.uuid1())),dict(edition="  "),
                      dict(excerpt={"text":"text","edition":"Synthetic edition","locator":"p1","representation_url":""})):
            with self.subTest(patch=patch),self.assertRaises(ValueError): validate(payload(**patch))


@unittest.skipUnless(os.environ.get("RESEARCH_TEST_DATABASE_URL"),"Requires real isolated PostgreSQL")
class SourceIntakeStoreTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from islam_research import database as db,source_intake
        from islam_research.sql_permissions import configure
        from psycopg import sql
        from psycopg.conninfo import make_conninfo
        cls.db,cls.store,cls.sql=db,source_intake,sql
        cls.dsn=os.environ["RESEARCH_TEST_DATABASE_URL"]
        cls.owner,cls.publisher="intake_owner_"+uuid.uuid4().hex,"intake_reader_"+uuid.uuid4().hex
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
        self.project="test:"+uuid.uuid4().hex
        with self.db.connect(self.owner_dsn) as connection: self.db.create_project(connection,self.project,"Synthetic intake project")

    def test_metadata_only_retry_after_edit_and_project_scoped_declarations(self):
        values=payload(self.project)
        with self.db.connect(self.owner_dsn) as connection:
            result=self.store.create(connection,**values)
            record=self.db.get_record(connection,result["record_id"])
            self.assertEqual((record["review_state"],record["origin"]),("pending","owner"))
            self.assertIsNone(result["document_id"])
            self.db.save_record(connection,record_id=record["id"],project_id=self.project,kind="source",title="Later correction",actor="synthetic-owner",expected_revision=1)
        with self.db.connect(self.owner_dsn) as connection:
            again=self.store.create(connection,**values)
            self.assertTrue(again["replayed"]);self.assertEqual(again["record_id"],result["record_id"])
            self.assertEqual(self.db.get_record(connection,result["record_id"])["title"],"Later correction")
            history=self.store.history(connection,self.project,result["record_id"],"",25)
            self.assertEqual(history[0]["declarations"]["coverage_scope"],"metadata_only")
            self.assertEqual(self.store.history(connection,"other",result["record_id"],"",25),[])
            with self.assertRaises(ValueError): self.store.create(connection,**{**values,"title":"Changed retry"})

    def test_located_excerpt_and_explicit_reuse_without_rewriting_source(self):
        values=payload(self.project,rights_status="permitted_excerpt",rights_basis="Synthetic authored fixture",coverage_scope="selected_passage",
                       excerpt=dict(text="😀 tafsīr and evidence.\r\nSynthetic quotation.",edition="Synthetic edition",locator="Section 2",representation_url="https://example.invalid/article#section2"))
        with self.db.connect(self.owner_dsn) as connection:
            result=self.store.create(connection,**values)
            document=connection.execute("SELECT * FROM research.reading_documents WHERE id=%s",(result["document_id"],)).fetchone()
            self.assertEqual(document["text_body"],values["excerpt"]["text"].replace("\r\n","\n"))
            again=self.store.create(connection,**values);self.assertTrue(again["replayed"])
            matches=self.store.candidates(connection,self.project,values["source_url"],values["identifier"])
            self.assertEqual(matches[0]["id"],result["record_id"])
            self.assertTrue(matches[0]["same_identifier"])
            with self.assertRaises(ValueError): self.store.create(connection,**{**values,"intake_uuid":str(uuid.uuid4())})
            reused=self.store.create(connection,**{**values,"intake_uuid":str(uuid.uuid4()),"existing_source_record_id":result["record_id"],"title":"Must not replace bibliography"})
            self.assertEqual(reused["document_id"],result["document_id"])
            self.assertEqual(self.db.get_record(connection,result["record_id"])["title"],values["title"])
            self.assertEqual(self.store.candidates(connection,"other",values["source_url"],values["identifier"]),[])

    def test_atomic_invalid_source_and_new_source_failure_leave_no_receipts_or_records(self):
        with self.db.connect(self.owner_dsn) as connection:
            for values in (payload(self.project,existing_source_record_id="not-in-project"),
                           payload(self.project,rights_status="permitted_excerpt",rights_basis="Fixture",coverage_scope="selected_passage",
                                   excerpt=dict(text="x",edition="Wrong edition",locator="p1",representation_url=""))):
                with self.assertRaises(ValueError): self.store.create(connection,**values)
            self.assertEqual(connection.execute("SELECT count(*) AS n FROM research.records WHERE project_id=%s",(self.project,)).fetchone()["n"],0)
            self.assertEqual(connection.execute("SELECT count(*) AS n FROM research.source_intakes WHERE project_id=%s",(self.project,)).fetchone()["n"],0)

    def test_concurrent_same_request_and_distinct_requests_share_identity_guard(self):
        values=payload(self.project)
        def run(value):
            with self.db.connect(self.owner_dsn) as connection:
                try:return self.store.create(connection,**value)
                except ValueError:return None
        with ThreadPoolExecutor(max_workers=2) as pool: results=list(pool.map(run,[values,values]))
        self.assertEqual(results[0]["record_id"],results[1]["record_id"])
        with ThreadPoolExecutor(max_workers=2) as pool:
            results=list(pool.map(run,[{**values,"intake_uuid":str(uuid.uuid4())},{**values,"intake_uuid":str(uuid.uuid4())}]))
        self.assertEqual(results,[None,None])
        distinct=run({**values,"intake_uuid":str(uuid.uuid4()),"distinct_source_rationale":"Separate translation/edition; shared landing page"})
        self.assertIsNotNone(distinct)

    def test_owner_receipt_immutable_and_publisher_cannot_read(self):
        from psycopg.errors import InsufficientPrivilege,CheckViolation
        with self.db.connect(self.owner_dsn) as connection:
            values=payload(self.project);self.store.create(connection,**values)
            for statement in ("DELETE FROM research.source_intakes","UPDATE research.source_intakes SET declarations='{}'",
                              "UPDATE research.records SET review_state='reviewed'"):
                with self.assertRaises(InsufficientPrivilege),connection.transaction():connection.execute(statement)
        with self.db.connect(self.publisher_dsn) as connection:
            with self.assertRaises(InsufficientPrivilege),connection.transaction():connection.execute("SELECT * FROM research.source_intakes")
        with self.db.connect(self.dsn) as connection:
            with self.assertRaises(CheckViolation),connection.transaction():
                connection.execute("UPDATE research.source_intakes SET input_sha256=repeat('a',64) WHERE request_uuid=%s",(values["intake_uuid"],))

    def test_reuse_canonical_record_preserves_rdf_authority_and_cross_project_rejected(self):
        source="test:"+uuid.uuid4().hex
        with self.db.connect(self.dsn) as connection:
            connection.execute("INSERT INTO research.records(id,project_id,kind,title,changed_by,origin) VALUES(%s,%s,'work','Canonical source','fixture','canonical_rdf')",(source,self.project))
        with self.db.connect(self.owner_dsn) as connection:
            result=self.store.create(connection,**payload(self.project,existing_source_record_id=source))
            self.assertEqual(result["record_id"],source)
            self.assertEqual(self.db.get_record(connection,source)["origin"],"canonical_rdf")
            other="test:"+uuid.uuid4().hex;self.db.create_project(connection,other,"Other project")
            with self.assertRaises(ValueError):self.store.create(connection,**payload(other,existing_source_record_id=source))
