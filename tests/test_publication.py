import json
import os
from pathlib import Path
import unittest
import uuid
from concurrent.futures import ThreadPoolExecutor

from islam_research import publication as pub


def synthetic_inputs():
    return {"project":{"id":"synthetic","title":"Synthetic project","graph_authority":"canonical_rdf","scope":"PRIVATE_PROJECT_SCOPE"},
            "records":[{"id":"source:1","project_id":"synthetic","kind":"source","title":"Synthetic source",
                "summary":"Explicitly selected summary","revision":1,"review_state":"pending","origin":"owner",
                "changed_by":"PRIVATE_ACTOR","attributes":{"note":"PRIVATE_ATTRIBUTE", "rdf_properties":{
                    pub.IR+"locator":['"Abstract"'],pub.DCT+"bibliographicCitation":['"Synthetic citation"'],
                    pub.IR+"reviewStatus":['"Abstract only; full argument not verified"'],
                    pub.DCT+"source":['<https://example.invalid/article>','<https://example.invalid/article?token=PRIVATE_TOKEN>',
                        '<http://127.0.0.1/private>','<https://user:PRIVATE_PASSWORD@example.invalid/>'],
                    pub.IR+"personalNote":['"PRIVATE_NESTED_NOTE"']}}}],"relations":[]}


class ProjectionTests(unittest.TestCase):
    def test_default_projection_excludes_private_attributes_and_opt_in_summary_metadata(self):
        source=synthetic_inputs()
        payload=pub.project_payload(source,[{"record_id":"source:1"}],[],snapshot_id="publication-"+"a"*32,generated_at="2026-10-15T00:00:00Z")
        text=json.dumps(payload)
        self.assertNotIn("PRIVATE_",text);self.assertNotIn("Explicitly selected summary",text)
        self.assertEqual(payload["nodes"][0]["status"],"pending")
        self.assertEqual(payload["nodes"][0]["links"],[])
        self.assertEqual(source,synthetic_inputs())
        payload=pub.project_payload(source,[{"record_id":"source:1","include_summary":True,"include_bibliography":True}],[],snapshot_id="publication-"+"b"*32,generated_at="2026-10-15T00:00:00Z")
        self.assertNotIn("PRIVATE_",json.dumps(payload))
        node=payload["nodes"][0]
        self.assertEqual(node["summary"],"Explicitly selected summary")
        self.assertEqual(node["locator"],"Abstract")
        self.assertEqual(node["links"],[{"url":"https://example.invalid/article","label":"example.invalid"}])
        self.assertIn("Abstract only; full argument not verified",node["review_limits"])

    def test_missing_duplicate_private_and_withdrawn_inputs_are_refused(self):
        for patch in [{"kind":"note"},{"kind":"annotation"},{"review_state":"withdrawn"}]:
            source=synthetic_inputs();source["records"][0].update(patch)
            with self.assertRaises(ValueError):
                pub.project_payload(source,[{"record_id":"source:1"}],[],snapshot_id="x",generated_at="x")
        for selection in [[],[{"record_id":"missing"}],[{"record_id":"source:1"}]*2]:
            with self.assertRaises(ValueError):
                pub.project_payload(synthetic_inputs(),selection,[],snapshot_id="x",generated_at="x")
        source=synthetic_inputs();source["relations"]=[{"id":"edge:1","from_id":"source:1","to_id":"unselected", "predicate":pub.IR+"source","review_state":"pending","provenance":{"private":"PRIVATE_EDGE"}}]
        with self.assertRaises(ValueError):
            pub.project_payload(source,[{"record_id":"source:1"}],["edge:1"],snapshot_id="x",generated_at="x")


@unittest.skipUnless(os.environ.get("RESEARCH_TEST_DATABASE_URL"),"Requires real isolated PostgreSQL")
class PublicationDatabaseTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from islam_research import database as db
        from islam_research.sql_permissions import configure
        from psycopg import sql
        from psycopg.conninfo import make_conninfo
        cls.db,cls.sql=db,sql
        cls.dsn=os.environ["RESEARCH_TEST_DATABASE_URL"]
        cls.owner,cls.publisher="pub_owner_"+uuid.uuid4().hex,"pub_reader_"+uuid.uuid4().hex
        with db.connect(cls.dsn) as connection:
            db.migrate(connection)
            for role in (cls.owner,cls.publisher):
                connection.execute(sql.SQL("CREATE ROLE {} LOGIN").format(sql.Identifier(role)))
            connection.commit();configure(connection,cls.owner,cls.publisher,apply=True)
        cls.owner_dsn=make_conninfo(cls.dsn,user=cls.owner)
        cls.publisher_dsn=make_conninfo(cls.dsn,user=cls.publisher)

    @classmethod
    def tearDownClass(cls):
        with cls.db.connect(cls.dsn) as connection:
            for role in (cls.owner,cls.publisher):
                connection.execute(cls.sql.SQL("DROP OWNED BY {}").format(cls.sql.Identifier(role)))
                connection.execute(cls.sql.SQL("DROP ROLE {}").format(cls.sql.Identifier(role)))

    def setUp(self):
        self.project,self.source="test:"+uuid.uuid4().hex,"test:"+uuid.uuid4().hex
        with self.db.connect(self.owner_dsn) as connection:
            self.db.create_project(connection,self.project,"Synthetic publication project")
            self.db.save_record(connection,record_id=self.source,project_id=self.project,kind="source",title="Synthetic source",summary="Selected summary",attributes={"private":"PRIVATE_ATTRIBUTE"},actor="test-owner")
            self.db.save_personal_state(connection,record_id=self.source,project_id=self.project,actor="test-owner",note="PRIVATE_READING_NOTE",reading="read",decision="not_relevant")
            from islam_research.passage_store import create_document
            create_document(connection,project_id=self.project,source_record_id=self.source,edition="Synthetic",locator="Abstract",representation_url="",text="PRIVATE_LICENSED_EXCERPT",actor="test-owner")

    def preview(self, **patch):
        with self.db.connect(self.owner_dsn) as connection:
            return pub.preview(connection,**{**dict(project_id=self.project,selections=[{"record_id":self.source,"include_summary":True}],relation_ids=[],actor="test-owner"),**patch})

    def approve(self, preview, **patch):
        with self.db.connect(self.owner_dsn) as connection:
            return pub.approve(connection,**{**dict(preview_id=preview["id"],expected_sha256=preview["payload_sha256"],expected_revision=0,rationale="Synthetic visibility and rights review",actor="test-owner",rights_checked=True),**patch})

    def test_preview_private_approval_public_read_and_retry_without_duplicate_event(self):
        from islam_research.api_store import PostgreSQLStore
        preview=self.preview();reader=PostgreSQLStore(self.publisher_dsn)
        self.assertTrue(reader.ready("public"));self.assertIsNone(reader.published(preview["id"]))
        self.assertNotIn("PRIVATE_",json.dumps(preview,default=str))
        first=self.approve(preview);again=self.approve(preview)
        self.assertEqual(first,again);self.assertEqual(first["revision"],1)
        public=reader.published(preview["id"])
        self.assertNotIn("PRIVATE_",json.dumps(public,default=str));self.assertNotIn("test-owner",json.dumps(public,default=str))
        self.assertEqual(public["payload"]["nodes"][0]["status"],"pending")
        with self.db.connect(self.owner_dsn) as connection:
            self.assertEqual(pub.head(connection,self.project)["snapshot_id"],preview["id"])
            count=connection.execute("SELECT count(*) AS n FROM research.publication_events WHERE project_id=%s",(self.project,)).fetchone()["n"]
            self.assertEqual(count,1)

    def test_changed_source_and_bad_digest_cannot_approve_but_personal_notes_do_not_invalidate(self):
        preview=self.preview()
        with self.assertRaises(self.db.RevisionConflict):self.approve(preview,expected_sha256="0"*64)
        with self.db.connect(self.owner_dsn) as connection:
            self.db.save_record(connection,record_id=self.source,project_id=self.project,kind="source",title="Changed source",expected_revision=1,actor="test-owner")
        with self.assertRaises(self.db.RevisionConflict):self.approve(preview)
        preview=self.preview()
        with self.db.connect(self.owner_dsn) as connection:
            self.db.save_personal_state(connection,record_id=self.source,project_id=self.project,actor="test-owner",expected_revision=1,note="NEW_PRIVATE_NOTE")
        self.assertEqual(self.approve(preview)["revision"],1)

    def test_two_publications_race_without_overwriting_and_withdrawal_blocks_old_public_routes(self):
        from islam_research.api_store import PostgreSQLStore
        previews=[self.preview(),self.preview()]
        def commit(preview):
            try:return self.approve(preview)
            except self.db.RevisionConflict:return None
        with ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(commit,previews))
        winners=[r for r in results if r];self.assertEqual(len(winners),1)
        active=winners[0]["snapshot_id"];reader=PostgreSQLStore(self.publisher_dsn)
        self.assertIsNotNone(reader.published(active))
        with self.db.connect(self.owner_dsn) as connection:
            withdrawn=pub.withdraw(connection,project_id=self.project,expected_revision=1,rationale="Synthetic correction",actor="test-owner")
        self.assertEqual(withdrawn["revision"],2);self.assertEqual(withdrawn["status"],"withdrawn")
        self.assertIsNone(reader.published(active))
        for preview in previews:
            with self.assertRaises(self.db.RevisionConflict):self.approve(preview)
        with self.db.connect(self.owner_dsn) as connection:
            self.assertEqual(connection.execute("SELECT count(*) AS n FROM research.publication_events WHERE project_id=%s",(self.project,)).fetchone()["n"],2)

    def test_runtime_cannot_rewrite_sealed_preview_public_rows_or_bypass_acknowledgement(self):
        from psycopg.errors import InsufficientPrivilege,CheckViolation
        preview=self.preview()
        with self.assertRaises(CheckViolation):self.approve(preview,rights_checked=False)
        with self.db.connect(self.owner_dsn) as connection:
            for statement in ["UPDATE research.publication_previews SET payload='{}'", "DELETE FROM research.publication_events", "UPDATE research_public.publication_heads SET status='withdrawn'", "INSERT INTO research_public.snapshots(id,project_id,payload) VALUES('bad','bad','{}')"]:
                with self.assertRaises(InsufficientPrivilege):
                    with connection.transaction():connection.execute(statement)
        with self.db.connect(self.publisher_dsn) as connection:
            with self.assertRaises(InsufficientPrivilege):
                with connection.transaction():connection.execute("SELECT research.approve_publication(%s,%s,0,'bad','bad',true)",(preview["id"],preview["payload_sha256"]))
        from psycopg.types.json import Jsonb
        # Even direct owner SQL cannot smuggle extra/private fields into a public projection.
        for patch in [{"notes":{"secret":"PRIVATE"}},{"generated_at":{"secret":"PRIVATE"}}]:
            with self.db.connect(self.owner_dsn) as connection:
                row=connection.execute("SELECT * FROM research.publication_previews WHERE id=%s",(preview["id"],)).fetchone()
                payload={**row["payload"],**patch};identifier="publication-"+uuid.uuid4().hex;payload["snapshot_id"]=identifier
                with self.assertRaises(CheckViolation):
                    with connection.transaction():
                        connection.execute("""INSERT INTO research.publication_previews(id,project_id,record_ids,relation_ids,inputs,payload,payload_sha256,created_by)
                            VALUES(%s,%s,%s,%s,%s,%s,encode(sha256(convert_to(%s::jsonb::text,'UTF8')),'hex'),'test-owner')""",
                            (identifier,self.project,row["record_ids"],[],Jsonb(row["inputs"]),Jsonb(payload),Jsonb(payload)))

    def test_canonical_pilot_keeps_locators_review_limits_and_recorded_predicates(self):
        from islam_research.database_import import import_turtle
        project="test:"+uuid.uuid4().hex
        with self.db.connect(self.dsn) as connection:
            # IDs are global: reuse the unchanged canonical fixture if another
            # contract already imported it, rather than rewriting graph identities.
            existing=connection.execute("SELECT project_id FROM research.records WHERE id='https://islam-research.local/id/sirry-2021-ulul-amr'").fetchone()
            if existing:
                project=existing["project_id"]
            else:
                self.db.create_project(connection,project,"Canonical pilot")
            import_turtle(connection,Path(__file__).resolve().parents[1]/"graph/research.ttl",project,actor="synthetic-importer",dry_run=False)
            records=connection.execute("SELECT id,kind FROM research.records WHERE project_id=%s",(project,)).fetchall()
            ids=[r["id"] for r in records if r["kind"] in pub.PUBLIC_KINDS]
            edges=connection.execute("SELECT id FROM research.relations WHERE project_id=%s AND from_id=ANY(%s) AND to_id=ANY(%s)",(project,ids,ids)).fetchall()
        preview=self.preview(project_id=project,selections=[{"record_id":v,"include_summary":True,"include_bibliography":True} for v in ids],relation_ids=[r["id"] for r in edges])
        payload=preview["payload"]
        self.assertEqual(payload["curated_graph"],"canonical_rdf")
        import hashlib
        self.assertEqual(payload["canonical_snapshot_sha256"],[hashlib.sha256((Path(__file__).resolve().parents[1]/"graph/research.ttl").read_bytes()).hexdigest()])
        self.assertTrue(any(n["locator"] for n in payload["nodes"] if n["type"]=="evidence"))
        self.assertTrue(any(n["links"] for n in payload["nodes"] if n["type"]=="source"))
        self.assertTrue(all(e["predicate"].startswith("http") for e in payload["edges"]))
        self.assertNotIn("synthetic-importer",json.dumps(payload));self.assertNotIn("rdf_properties",json.dumps(payload))
        with self.db.connect(self.owner_dsn) as connection:
            revision=pub.head(connection,project)["revision"]
        self.assertEqual(self.approve(preview,expected_revision=revision)["status"],"published")

    def test_signed_owner_http_approval_and_public_withdrawal_use_restricted_roles(self):
        import time
        import jwt
        from cryptography.hazmat.primitives.asymmetric import ec
        from fastapi.testclient import TestClient
        from islam_research.api import Settings,create_app
        from islam_research.api_auth import IAPVerifier,IAP_ISSUER
        key=ec.generate_private_key(ec.SECP256R1());audience="/projects/123456789012/locations/us-central1/services/synthetic-owner"
        subject="synthetic-owner";origin="https://research.example.invalid";now=int(time.time())
        token=jwt.encode(dict(iss=IAP_ISSUER,aud=audience,sub=subject,iat=now,exp=now+600),key,algorithm="ES256",headers={"kid":"test-key"})
        headers={"x-goog-iap-jwt-assertion":token,"x-research-write":"1","origin":origin}
        owner=TestClient(create_app(Settings(self.owner_dsn,owner_subject=subject,iap_audience=audience,owner_origin=origin),verifier=IAPVerifier(audience,subject,loader=lambda:{"test-key":key.public_key()})))
        public=TestClient(create_app(Settings(self.publisher_dsn,mode="public")))
        preview_response=owner.post("/v1/publication/previews",json={"project_id":self.project,"selections":[{"record_id":self.source,"include_summary":True}]},headers=headers)
        self.assertEqual(preview_response.status_code,201,preview_response.text)
        preview=preview_response.json()
        self.assertEqual(owner.get("/v1/publication/preview",params={"project_id":"different","preview_id":preview["id"]},headers=headers).status_code,404)
        self.assertEqual(public.get("/v1/public/snapshots/"+preview["id"]).status_code,404)
        result=owner.post("/v1/publication/approve",json={"preview_id":preview["id"],"expected_sha256":preview["payload_sha256"],"expected_revision":0,"rationale":"Synthetic visibility review","rights_checked":True},headers=headers)
        self.assertEqual(result.status_code,200,result.text)
        result=public.get("/v1/public/snapshots/"+preview["id"])
        self.assertEqual(result.status_code,200);self.assertNotIn("PRIVATE_",result.text)
        self.assertEqual(owner.post("/v1/publication/withdraw",json={"project_id":self.project,"expected_revision":1,"rationale":"Synthetic correction"},headers=headers).status_code,200)
        self.assertEqual(public.get("/v1/public/snapshots/"+preview["id"]).status_code,404)
