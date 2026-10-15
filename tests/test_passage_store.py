import os
import unittest
import uuid


@unittest.skipUnless(os.environ.get("RESEARCH_TEST_DATABASE_URL"), "Requires real isolated PostgreSQL")
class PassageStoreTests(unittest.TestCase):
    def setUp(self):
        from islam_research import database as db
        from islam_research import passage_store as store
        self.db,self.store=db,store
        self.dsn=os.environ["RESEARCH_TEST_DATABASE_URL"]
        self.project,self.source="test:"+uuid.uuid4().hex,"test:"+uuid.uuid4().hex
        with db.connect(self.dsn) as connection:
            db.migrate(connection)
            db.create_project(connection,self.project,"Synthetic passage project")
            db.save_record(connection,record_id=self.source,project_id=self.project,kind="source",title="Synthetic source",actor="test-owner")
            self.document=store.create_document(connection,project_id=self.project,source_record_id=self.source,
                edition="Synthetic edition",locator="Abstract",representation_url="https://example.invalid/source",
                text="😀 A note about tafsīr, evidence, and authority.",actor="test-owner")

    def capture(self,connection,**patch):
        text=self.document["text_body"]; start=text.index("tafsīr")
        payload=dict(annotation_uuid=str(uuid.uuid4()),project_id=self.project,document_id=self.document["id"],
            text_sha256=self.document["text_sha256"],start=start,end=start+6,exact="tafsīr",capture_kind="term_candidate",body="Synthetic private note",actor="test-owner")
        return self.store.create_annotation(connection,**{**payload,**patch})

    def test_immutable_snapshot_import_is_idempotent_and_project_scoped(self):
        with self.db.connect(self.dsn) as connection:
            again=self.store.create_document(connection,project_id=self.project,source_record_id=self.source,
                edition="Synthetic edition",locator="Abstract",representation_url="https://example.invalid/source",text=self.document["text_body"],actor="test-owner")
            self.assertEqual(again["id"],self.document["id"])
            self.assertIsNone(self.store.get_document(connection,"another-project",self.document["id"]))
            self.assertNotIn("text_body",self.store.documents(connection,self.project,self.source,"",26)[0])
            from psycopg.errors import CheckViolation
            with self.assertRaises(CheckViolation):
                with connection.transaction():
                    connection.execute("UPDATE research.reading_documents SET text_body='changed' WHERE id=%s",(self.document["id"],))

    def test_capture_retry_revision_history_and_stale_write(self):
        identifier=str(uuid.uuid4())
        with self.db.connect(self.dsn) as connection:
            first=self.capture(connection,annotation_uuid=identifier)
            repeated=self.capture(connection,annotation_uuid=identifier)
            self.assertEqual(first["id"],repeated["id"])
            count=connection.execute("SELECT count(*) AS n FROM research.reading_annotation_revisions WHERE annotation_id=%s",(first["id"],)).fetchone()["n"]
            self.assertEqual(count,1)
            from psycopg.errors import CheckViolation
            with self.assertRaises(CheckViolation):
                with connection.transaction():
                    connection.execute("""INSERT INTO research.reading_annotations
                        (id,project_id,document_id,text_sha256,start_pos,end_pos,exact,prefix,suffix,capture_kind,body,changed_by)
                        SELECT %s,project_id,document_id,text_sha256,start_pos,end_pos,'WRONG!',prefix,suffix,capture_kind,body,changed_by
                        FROM research.reading_annotations WHERE id=%s""",("urn:synthetic:"+uuid.uuid4().hex,first["id"]))
            bundle=self.store.annotation(connection,self.project,first["id"])
            self.assertTrue(bundle["anchor"]["anchored"])
            self.assertEqual(bundle["web_annotation"]["ir:edition"],"Synthetic edition")
            updated=self.store.update_annotation(connection,annotation_id=first["id"],project_id=self.project,
                body="Updated private observation",expected_revision=1,actor="test-owner")
            self.assertEqual(updated["revision"],2)
            with self.assertRaises(self.db.RevisionConflict):
                self.store.update_annotation(connection,annotation_id=first["id"],project_id=self.project,
                    body="Stale note",expected_revision=1,actor="test-owner")
            self.assertEqual(connection.execute("SELECT count(*) AS n FROM research.reading_annotation_revisions WHERE annotation_id=%s",(first["id"],)).fetchone()["n"],2)

    def test_bad_quotes_versions_kinds_and_project_targets_do_not_create_captures(self):
        with self.db.connect(self.dsn) as connection:
            for patch in [{"exact":"wrong"},{"text_sha256":"0"*64},{"project_id":"other"},{"capture_kind":"verified_definition"}]:
                with self.assertRaises(ValueError):
                    self.capture(connection,**patch)
            self.assertEqual(self.store.annotations(connection,self.project,self.document["id"],"",101),[])

    def test_snapshot_and_annotation_tables_are_not_granted_to_public(self):
        with self.db.connect(self.dsn) as connection:
            for table in ["reading_documents","reading_annotations","reading_annotation_revisions"]:
                grants=connection.execute("SELECT * FROM information_schema.table_privileges WHERE table_schema='research' AND table_name=%s AND grantee='PUBLIC'",(table,)).fetchall()
                self.assertEqual(grants,[])

    def test_mark_style_and_note_are_revisioned_together_without_moving_the_source(self):
        identifier=str(uuid.uuid4())
        with self.db.connect(self.dsn) as connection:
            first=self.capture(connection,annotation_uuid=identifier,mark_style="underline")
            self.assertEqual(first["mark_style"],"underline")
            self.assertEqual(first,self.capture(connection,annotation_uuid=identifier,mark_style="underline"))
            with self.assertRaises(self.db.RevisionConflict):
                self.capture(connection,annotation_uuid=identifier,mark_style="highlight")
            values=dict(annotation_id=first["id"],project_id=self.project,body="Revised margin note",expected_revision=1,actor="test-owner",mark_style="none")
            revised=self.store.update_annotation(connection,**values)
            self.assertEqual(revised["revision"],2)
            self.assertEqual(revised["mark_style"],"none")
            self.assertEqual(self.store.update_annotation(connection,**values),revised)
            for field in ["document_id","text_sha256","start_pos","end_pos","exact","prefix","suffix"]:
                self.assertEqual(first[field],revised[field])
            with self.assertRaises(self.db.RevisionConflict):
                self.store.update_annotation(connection,**{**values,"mark_style":"highlight"})
            body_only=self.store.update_annotation(connection,**{**values,"mark_style":None,"expected_revision":2,"body":"Body only preserves style"})
            self.assertEqual(body_only["mark_style"],"none")
            bundle=self.store.annotation(connection,self.project,first["id"])
            self.assertEqual(bundle["web_annotation"]["ir:markStyle"],"none")
            history=connection.execute("SELECT snapshot FROM research.reading_annotation_revisions WHERE annotation_id=%s ORDER BY revision",(first["id"],)).fetchall()
            self.assertEqual([r["snapshot"]["mark_style"] for r in history],["underline","none","none"])
            self.assertEqual(self.store.annotations(connection,self.project,self.document["id"],"",101)[0]["mark_style"],"none")

    def test_unknown_style_is_rejected_by_storage_and_database(self):
        from psycopg.errors import CheckViolation
        with self.db.connect(self.dsn) as connection:
            for style in ["reviewed","",True,123]:
                with self.assertRaises(ValueError): self.capture(connection,mark_style=style)
            first=self.capture(connection)
            self.assertEqual(first["mark_style"],"highlight")
            with self.assertRaises(CheckViolation):
                with connection.transaction():
                    connection.execute("UPDATE research.reading_annotations SET mark_style='reviewed',revision=revision+1 WHERE id=%s",(first["id"],))

    def test_notice_remains_with_immutable_representation_and_selected_quote_export(self):
        notice="Synthetic provider notice; attribution https://example.invalid/notice"
        values=dict(project_id=self.project,source_record_id=self.source,edition="Synthetic noticed edition",locator="Paragraph 1",
            representation_url="https://example.invalid/source",text="tafsīr and evidence",actor="test-owner",source_notice=notice)
        with self.db.connect(self.dsn) as connection:
            document=self.store.create_document(connection,**values)
            self.assertEqual(self.store.create_document(connection,**values)["id"],document["id"])
            other=self.store.create_document(connection,**{**values,"source_notice":"Different synthetic notice"})
            self.assertNotEqual(other["id"],document["id"])
            self.assertEqual(self.store.get_document(connection,self.project,document["id"])["source_notice"],notice)
            annotation=self.store.create_annotation(connection,annotation_uuid=str(uuid.uuid4()),project_id=self.project,document_id=document["id"],
                text_sha256=document["text_sha256"],start=0,end=6,exact="tafsīr",capture_kind="comment",body="Private note",actor="test-owner")
            self.assertEqual(self.store.annotation(connection,self.project,annotation["id"])["web_annotation"]["ir:sourceNotice"],notice)
            from psycopg.errors import CheckViolation
            with self.assertRaises(CheckViolation):
                with connection.transaction(): connection.execute("UPDATE research.reading_documents SET source_notice='' WHERE id=%s",(document["id"],))
