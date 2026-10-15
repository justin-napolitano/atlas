import os
from pathlib import Path
import re
import unittest
import uuid

from islam_research.quran_citations import AYAH_COUNTS


class VerseMaterialProfileTests(unittest.TestCase):
    def test_material_bounds_match_the_declared_attributed_reference_profile(self):
        text = (Path(__file__).parents[1]/"src/islam_research/migrations/0009_private_verse_materials.sql").read_text()
        self.assertEqual(tuple(map(int, re.search(r"counts integer\[\] := ARRAY\[([\d,]+)\]", text)[1].split(","))), AYAH_COUNTS)


@unittest.skipUnless(os.environ.get("RESEARCH_TEST_DATABASE_URL"), "Requires real isolated PostgreSQL")
class VerseStoreTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from islam_research import database as db, verse_store, passage_store, citation_store
        from islam_research.sql_permissions import configure
        from psycopg import sql
        from psycopg.conninfo import make_conninfo
        cls.db, cls.store, cls.passages, cls.citations, cls.sql = db, verse_store, passage_store, citation_store, sql
        cls.dsn = os.environ["RESEARCH_TEST_DATABASE_URL"]
        cls.owner, cls.publisher = "verse_owner_"+uuid.uuid4().hex, "verse_reader_"+uuid.uuid4().hex
        with db.connect(cls.dsn) as connection:
            db.migrate(connection)
            for role in (cls.owner, cls.publisher):
                connection.execute(sql.SQL("CREATE ROLE {} LOGIN").format(sql.Identifier(role)))
            connection.commit()
            configure(connection, cls.owner, cls.publisher, apply=True)
        cls.owner_dsn = make_conninfo(cls.dsn, user=cls.owner)
        cls.publisher_dsn = make_conninfo(cls.dsn, user=cls.publisher)

    @classmethod
    def tearDownClass(cls):
        with cls.db.connect(cls.dsn) as connection:
            for role in (cls.owner, cls.publisher):
                connection.execute(cls.sql.SQL("DROP OWNED BY {}").format(cls.sql.Identifier(role)))
                connection.execute(cls.sql.SQL("DROP ROLE {}").format(cls.sql.Identifier(role)))

    def setUp(self):
        self.project, self.source, self.request = "test:"+uuid.uuid4().hex, "test:"+uuid.uuid4().hex, str(uuid.uuid4())
        with self.db.connect(self.owner_dsn) as connection:
            self.db.create_project(connection, self.project, "Synthetic verse reader project")
            self.db.save_record(connection, record_id=self.source, project_id=self.project, kind="source", title="Synthetic located commentary", actor="owner")
            text = "😀 PRIVATE OUTSIDE. " + "x"*100 + " Discusses Q 4:59 and 83; التفسير. " + "z"*100
            self.document = self.passages.create_document(connection, project_id=self.project, source_record_id=self.source,
                edition="Synthetic critical edition", locator="Synthetic section 3, p. 8", representation_url="https://example.invalid/commentary", text=text, actor="owner")
            selected = "Discusses Q 4:59 and 83; التفسير."
            self.annotation = self.passages.create_annotation(connection, annotation_uuid=str(uuid.uuid4()), project_id=self.project,
                document_id=self.document["id"], text_sha256=self.document["text_sha256"], start=text.index(selected),
                end=text.index(selected)+len(selected), exact=selected, capture_kind="comment", body="Private reading note", actor="owner")
            self.candidate = self.citations.candidates(connection, self.project, self.annotation["id"])["candidates"][0]

    def metadata(self, **patch):
        return {**dict(attribution="Synthetic commentator, attributed by owner", language_tag="en", source_scope="Only this located synthetic passage",
            assertion_mode="none", assertion_text="", reading_note="", period_note="", tradition_note="", context_basis="",
            rationale="Explicit owner link; no interpretation review", state="active"), **patch}

    def create(self, connection, **patch):
        return self.store.create(connection, **{**dict(request_uuid=self.request, project_id=self.project, annotation_id=self.annotation["id"],
            chapter=4, ayah_start=59, ayah_end=59, material_kind="tafsir", link_kind="discussion", citation_basis="none",
            citation_id=None, marker_start=None, marker_end=None, actor="owner"), **self.metadata(), **patch})

    def resolve(self, connection, **patch):
        return self.citations.resolve(connection, **{**dict(project_id=self.project, annotation_id=self.annotation["id"], candidate_key=self.candidate["key"],
            decision="confirmed", chapter=4, ayah_start=59, ayah_end=59, rationale="Synthetic numeric citation confirmation", expected_revision=0, actor="owner"), **patch})

    def test_source_binding_two_way_range_filters_and_page_boundaries(self):
        with self.db.connect(self.owner_dsn) as connection:
            first = self.create(connection)
            second = self.create(connection, request_uuid=str(uuid.uuid4()), material_kind="scholarship", ayah_start=59, ayah_end=83)
            for identity in [first, second]:
                row = self.store.get_material(connection, self.project, identity["id"])
                self.assertEqual(row["document_id"], self.document["id"])
                self.assertEqual(row["selected_quote"], self.annotation["exact"])
                self.assertEqual(row["text_sha256"], self.document["text_sha256"])
                self.assertEqual(row["edition"], self.document["edition"])
                self.assertEqual(row["metadata_status"], "owner_declared_pending_review")
                self.assertEqual(row["review_state"], "pending")
                self.assertEqual(row["reference"]["chapter"], 4)
            self.assertEqual([r["id"] for r in self.store.for_verse(connection,self.project,4,83,83,None,None,"",26)], [second["id"]])
            self.assertEqual([r["id"] for r in self.store.for_verse(connection,self.project,4,59,59,"tafsir","discussion","",26)], [first["id"]])
            page = self.store.for_verse(connection,self.project,4,59,59,None,None,"",1)
            rest = self.store.for_verse(connection,self.project,4,59,59,None,None,page[0]["id"],1)
            self.assertEqual(len(page+rest),2)
            self.assertNotEqual(page[0]["id"],rest[0]["id"])
            self.assertEqual(len(self.store.annotation_links(connection,self.project,self.annotation["id"],"",26)),2)
            self.assertIsNone(self.store.annotation_links(connection,"other",self.annotation["id"],"",26))
            self.assertIsNone(self.store.get_material(connection,"other",first["id"]))
            self.assertIsNone(self.store.history(connection,"other",first["id"],None,26))
            self.assertEqual(self.store.for_verse(connection,"other",4,59,59,None,None,"",26),[])

    def test_revision_correction_lost_ack_retry_original_creation_replay_and_withdrawal(self):
        with self.db.connect(self.owner_dsn) as connection:
            created = self.create(connection)
            self.assertEqual(created,self.create(connection))
            params = dict(project_id=self.project,material_id=created["id"],expected_revision=1,actor="owner",**self.metadata(reading_note="Corrected context"))
            revised = self.store.update(connection,**params)
            self.assertEqual(revised["revision"],2)
            self.assertEqual(self.store.update(connection,**params),revised)
            self.assertEqual(self.create(connection)["revision"],2)
            with self.assertRaises(self.db.RevisionConflict):
                self.store.update(connection,**{**params,"reading_note":"Stale different edit"})
            with self.assertRaisesRegex(ValueError,"different verse material"):
                self.create(connection,ayah_start=83,ayah_end=83)
            with self.assertRaisesRegex(ValueError,"different verse material"):
                self.create(connection,actor="different-owner")
            self.store.update(connection,**{**params,"expected_revision":2,"state":"withdrawn"})
            self.assertEqual(self.store.for_verse(connection,self.project,4,59,59,None,None,"",26),[])
            self.assertEqual(self.store.annotation_links(connection,self.project,self.annotation["id"],"",26),[])
            self.assertEqual(self.store.get_material(connection,self.project,created["id"])["state"],"withdrawn")
            history = self.store.history(connection,self.project,created["id"],None,2)
            self.assertEqual([r["revision"] for r in history],[3,2])
            self.assertEqual(self.store.history(connection,self.project,created["id"],2,2)[0]["revision"],1)
            self.assertEqual(history[1]["snapshot"]["reading_note"],"Corrected context")
            self.store.update(connection,**{**params,"expected_revision":3})
            self.assertEqual(len(self.store.for_verse(connection,self.project,4,59,59,None,None,"",26)),1)

    def test_confirmed_citation_snapshot_cannot_silently_follow_correction_or_dismissal(self):
        with self.db.connect(self.owner_dsn) as connection:
            citation = self.resolve(connection)
            created = self.create(connection,link_kind="explicit_citation",citation_basis="resolved_reference",citation_id=citation["id"])
            row = self.store.get_material(connection,self.project,created["id"])
            self.assertEqual(row["citation_snapshot"]["revision"],1)
            self.assertEqual(row["marker_text"],"Q 4:59")
            self.assertFalse(row["citation_changed_needs_review"])
            self.resolve(connection,expected_revision=1,ayah_start=60,ayah_end=60,rationale="Owner corrected target; material must stay put")
            row = self.store.get_material(connection,self.project,created["id"])
            self.assertTrue(row["citation_changed_needs_review"])
            self.assertEqual(row["reference"]["ayah_start"],59)
            self.assertEqual(row["current_citation_start"],60)
            self.assertEqual(row["citation_snapshot"]["chapter"],4)
            self.assertEqual(len(self.store.for_verse(connection,self.project,4,59,59,None,None,"",26)),1)
            self.assertEqual(self.store.for_verse(connection,self.project,4,60,60,None,None,"",26),[])
            # Metadata remains correctable while stale proof is visibly flagged.
            fixed = self.store.update(connection,project_id=self.project,material_id=created["id"],expected_revision=1,actor="owner",**self.metadata(reading_note="Review changed citation"))
            self.assertTrue(fixed["citation_changed_needs_review"])
            self.resolve(connection,expected_revision=2,decision="dismissed",chapter=None,ayah_start=None,ayah_end=None,rationale="Owner dismissed")
            self.assertTrue(self.store.get_material(connection,self.project,created["id"])["citation_changed_needs_review"])
            with self.assertRaises(ValueError):
                self.create(connection,request_uuid=str(uuid.uuid4()),link_kind="explicit_citation",citation_basis="resolved_reference",citation_id=citation["id"])

    def test_owner_marker_exact_unicode_and_manual_mapping_is_not_detected_citation(self):
        with self.db.connect(self.owner_dsn) as connection:
            manual = self.resolve(connection,candidate_key="manual")
            with self.assertRaises(ValueError):
                self.create(connection,link_kind="explicit_citation",citation_basis="resolved_reference",citation_id=manual["id"])
            start = self.annotation["exact"].index("التفسير")
            created = self.create(connection,link_kind="explicit_citation",citation_basis="owner_identified",marker_start=start,marker_end=start+len("التفسير"))
            row = self.store.get_material(connection,self.project,created["id"])
            self.assertEqual(row["marker_text"],"التفسير")
            self.assertEqual(row["citation_basis"],"owner_identified")
            self.assertIsNone(row["citation_snapshot"])

    def test_representation_interpretation_and_context_assertions_remain_separate(self):
        with self.db.connect(self.owner_dsn) as connection:
            quoted = self.create(connection,link_kind="interpretive_claim",assertion_mode="quotation",assertion_text=self.annotation["exact"],
                period_note="Synthetic date claim",tradition_note="Synthetic school claim",context_basis="Located introductory note in this same captured passage; owner assertion")
            row = self.store.get_material(connection,self.project,quoted["id"])
            self.assertEqual(row["assertion_text"],self.annotation["exact"])
            translated = self.create(connection,request_uuid=str(uuid.uuid4()),material_kind="translation",link_kind="representation",language_tag="en")
            self.assertEqual(self.store.get_material(connection,self.project,translated["id"])["link_kind"],"representation")
            for patch in [{"chapter":115},{"chapter":True},{"ayah_start":177,"ayah_end":177}, {"material_kind":"unknown"},
                          {"material_kind":"translation"}, {"link_kind":"representation"}, {"assertion_text":"Hidden claim"},
                          {"link_kind":"interpretive_claim"}, {"link_kind":"interpretive_claim","assertion_mode":"quotation","assertion_text":"Altered quotation"},
                          {"period_note":"Unlocated historical claim"}, {"tradition_note":"Unlocated school"}, {"state":"withdrawn"},
                          {"language_tag":"en--US"}, {"citation_basis":"owner_identified","marker_start":0,"marker_end":4},
                          {"link_kind":"explicit_citation","citation_basis":"none"}, {"marker_start":0,"marker_end":4},
                          {"project_id":"other"}]:
                with self.subTest(patch=patch):
                    with self.assertRaises(ValueError):
                        self.create(connection,request_uuid=str(uuid.uuid4()),**patch)
            self.assertEqual(connection.execute("SELECT count(*) AS n FROM research.verse_materials WHERE project_id=%s",(self.project,)).fetchone()["n"],2)

    def test_sql_guards_immutable_binding_exact_quotes_profile_history_and_public_access(self):
        from psycopg.errors import CheckViolation, InsufficientPrivilege
        with self.db.connect(self.owner_dsn) as connection:
            created = self.create(connection,link_kind="interpretive_claim",assertion_mode="quotation",assertion_text=self.annotation["exact"])
            for assignment in ["assertion_text='Altered quote',revision=revision+1", "period_note='Unlocated date',revision=revision+1", "revision=revision+2"]:
                with self.assertRaises(CheckViolation):
                    with connection.transaction():
                        connection.execute("UPDATE research.verse_materials SET "+assignment+" WHERE id=%s",(created["id"],))
            for query in ["UPDATE research.verse_materials SET chapter=5 WHERE id=%s", "UPDATE research.verse_materials SET review_state='reviewed' WHERE id=%s",
                          "DELETE FROM research.verse_materials WHERE id=%s", "DELETE FROM research.verse_material_revisions WHERE material_id=%s"]:
                with self.assertRaises(InsufficientPrivilege):
                    with connection.transaction(): connection.execute(query,(created["id"],))
        with self.db.connect(self.dsn) as connection:
            for assignment in ["chapter=5,revision=revision+1", "ayah_end=177,revision=revision+1", "text_sha256=repeat('a',64),revision=revision+1"]:
                with self.assertRaises(CheckViolation):
                    with connection.transaction(): connection.execute("UPDATE research.verse_materials SET "+assignment+" WHERE id=%s",(created["id"],))
        with self.db.connect(self.publisher_dsn) as connection:
            for table in ["verse_materials","verse_material_revisions"]:
                with self.assertRaises(InsufficientPrivilege):
                    with connection.transaction(): connection.execute("SELECT * FROM research."+table)

    def test_publication_preview_does_not_publish_material_or_its_quotation(self):
        import json
        from islam_research import publication
        with self.db.connect(self.owner_dsn) as connection:
            row = self.create(connection)
            preview = publication.preview(connection,project_id=self.project,selections=[{"record_id":self.source,"include_summary":True,"include_bibliography":True}],relation_ids=[],actor="owner")
            payload = json.dumps(preview["payload"],default=str)
            for private in [row["id"],self.annotation["exact"],self.document["text_sha256"],self.annotation["body"]]:
                self.assertNotIn(private,payload)

    def test_retry_isolation_requirement_fails_before_write(self):
        with self.db.connect(self.owner_dsn) as connection:
            connection.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ")
            with self.assertRaisesRegex(ValueError,"READ COMMITTED"):
                self.create(connection)
            self.assertEqual(connection.execute("SELECT count(*) AS n FROM research.verse_materials WHERE project_id=%s",(self.project,)).fetchone()["n"],0)

    def test_actual_pilot_import_preserves_notice_exact_text_retry_and_pending_review(self):
        from islam_research.quran_resources import pilot_resource
        resource=pilot_resource()
        params=dict(request_uuid=str(uuid.uuid4()),project_id=self.project,chapter=4,ayah=59,rationale="Explicit identified pilot import",actor="owner")
        with self.db.connect(self.owner_dsn) as connection:
            first=self.store.import_pilot(connection,**params)
            self.assertEqual(self.store.import_pilot(connection,**params),first)
            document=self.passages.get_document(connection,self.project,first["document_id"])
            self.assertEqual(document["text_body"],resource["verses"][0]["text"])
            self.assertIn(resource["source_notice"],document["source_notice"])
            annotation=self.passages.annotation(connection,self.project,first["annotation_id"])
            self.assertEqual(annotation["web_annotation"]["ir:sourceNotice"],document["source_notice"])
            self.passages.update_annotation(connection,annotation_id=first["annotation_id"],project_id=self.project,body="My later private reading note",expected_revision=1,actor="owner")
            self.assertEqual(self.store.import_pilot(connection,**params),first)
            self.assertEqual(self.passages.annotation(connection,self.project,first["annotation_id"])["annotation"]["body"],"My later private reading note")
            another=self.store.import_pilot(connection,**{**params,"request_uuid":str(uuid.uuid4()),"ayah":83})
            self.assertEqual(another["record_id"],first["record_id"])
            self.assertNotEqual(another["document_id"],first["document_id"])
            self.assertEqual(connection.execute("SELECT review_state FROM research.records WHERE id=%s",(first["record_id"],)).fetchone()["review_state"],"pending")
            for patch in [{"ayah":83},{"rationale":"Changed request"},{"project_id":"other"}]:
                with self.assertRaises(ValueError): self.store.import_pilot(connection,**{**params,**patch})
            with self.assertRaises(ValueError): self.store.import_pilot(connection,**{**params,"request_uuid":str(uuid.uuid4()),"ayah":60})
