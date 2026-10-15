import json
import os
import time
import unittest
import uuid

try:
    import jwt
    from cryptography.hazmat.primitives.asymmetric import ec
    from fastapi.testclient import TestClient
    from islam_research.api import Settings, create_app
    from islam_research.api_auth import IAPVerifier, IAP_ISSUER
    from islam_research import database as db
except ModuleNotFoundError:
    if os.environ.get("RESEARCH_TEST_DATABASE_URL"):
        raise
    jwt = None

AUDIENCE = "/projects/123456789012/locations/us-central1/services/synthetic-owner"
OWNER = "synthetic-owner-subject"
ORIGIN = "https://research.example.invalid"


class MemoryBoundaryStore:
    """Only a transport test adapter; database guarantees have separate real-PG tests."""
    def ready(self, mode):
        return True
    def source_intake(self, **values):
        return {"project_id":values["project_id"],"record_id":"synthetic:source","document_id":None,"actor":values["actor"]}
    def source_candidates(self,*args):
        return []
    def source_intake_history(self,*args):
        return []
    def projects(self):
        return [{"id": "synthetic", "title": "Synthetic project"}]
    def save_state(self, **value):
        return {**value, "revision": 1}
    def published(self, snapshot_id):
        return {"id": snapshot_id, "payload": {"nodes": []}}
    def evidence_path(self, project_id, record_id, profile_id):
        return {"project_id": project_id, "start_id": record_id, "profile": profile_id, "paths": []}
    def search(self, project_id, query, scope, kind, limit):
        return {"scope": scope, "items": []}
    def publication_preview(self, **value):
        return {"actor":value["actor"],"id":"publication-"+"a"*32,"payload":{}}
    def publication_approve(self, **value):
        return {"revision":1,"actor":value["actor"],"status":"published"}
    def publication_withdraw(self, **value):
        return {"revision":2,"actor":value["actor"],"status":"withdrawn"}
    def publication_relations(self, **value):
        return {"items":[],"truncated":False}
    def resolve_scripture_citation(self, **value):
        return {**value,"revision":1}
    def scripture_candidates(self, project_id, annotation_id):
        return {"candidates":[],"resolutions":[]}
    def lexicon_capture(self, **value):
        return {"actor":value["actor"],"concept_id":"synthetic:concept","occurrence_id":"synthetic:occurrence"}
    def lexicon_create_definition(self, **value):
        return {"actor":value["actor"],"revision":1}


@unittest.skipUnless(jwt, "Install api and test extras for HTTP contract tests")
class APIBoundaryTests(unittest.TestCase):
    def setUp(self):
        self.key = ec.generate_private_key(ec.SECP256R1())
        self.settings = Settings("synthetic-not-a-live-dsn", owner_subject=OWNER,
                                 iap_audience=AUDIENCE, owner_origin=ORIGIN)
        self.verifier = IAPVerifier(AUDIENCE, OWNER, loader=lambda: {"test-key": self.key.public_key()})
        self.app = create_app(self.settings, store=MemoryBoundaryStore(), verifier=self.verifier)
        self.client = TestClient(self.app)

    def headers(self, sub=OWNER, **extra):
        now = int(time.time())
        token = jwt.encode(dict(iss=IAP_ISSUER, aud=AUDIENCE, sub=sub, iat=now, exp=now+600),
                           self.key, algorithm="ES256", headers={"kid": "test-key"})
        return {"x-goog-iap-jwt-assertion": token, "x-research-write": "1", "origin": ORIGIN, **extra}

    def test_missing_config_and_unsigned_headers_fail_closed(self):
        with self.assertRaises(ValueError):
            Settings("synthetic-not-a-live-dsn")
        result = self.client.get("/v1/projects", headers={"x-goog-authenticated-user-email": "synthetic-owner@example.invalid"})
        self.assertEqual(result.status_code, 401)
        self.assertEqual(self.client.get("/v1/projects", headers=self.headers(sub="other")).status_code, 403)
        self.assertEqual(self.client.get("/v1/projects", headers=self.headers()).status_code, 200)

    def test_source_intake_is_owner_only_strict_confirmed_and_never_promotes_review(self):
        from test_source_intake import payload
        value=payload();value.pop("actor")
        self.assertEqual(self.client.post("/v1/source-intakes",json=value).status_code,401)
        self.assertEqual(self.client.post("/v1/source-intakes",json=value,headers=self.headers(sub="other")).status_code,403)
        missing=self.headers();missing.pop("x-research-write")
        self.assertEqual(self.client.post("/v1/source-intakes",json=value,headers=missing).status_code,403)
        for patch in (dict(owner_confirmed=1),dict(owner_confirmed=False),dict(review_state="reviewed"),dict(actor="spoof")):
            self.assertEqual(self.client.post("/v1/source-intakes",json={**value,**patch},headers=self.headers()).status_code,422)
        result=self.client.post("/v1/source-intakes",json=value,headers=self.headers())
        self.assertEqual(result.status_code,201);self.assertEqual(result.json()["actor"],OWNER)
        for route in ("/v1/source-intakes","/v1/source-intakes/candidates"):
            self.assertEqual(self.client.get(route,params={"project_id":"synthetic","source_record_id":"synthetic:source"}).status_code,401)
        public=TestClient(create_app(Settings("synthetic",mode="public"),store=MemoryBoundaryStore()))
        self.assertEqual(public.post("/v1/source-intakes",json=value).status_code,404)
        self.assertEqual(public.get("/v1/source-intakes/candidates").status_code,404)

    def test_write_requires_csrf_boundary_and_owner(self):
        payload = {"record_id": "synthetic", "project_id": "synthetic", "note": "Synthetic private note"}
        self.assertEqual(self.client.put("/v1/personal-states", json=payload).status_code, 401)
        headers = self.headers()
        headers.pop("x-research-write")
        self.assertEqual(self.client.put("/v1/personal-states", json=payload, headers=headers).status_code, 403)
        self.assertEqual(self.client.put("/v1/personal-states", json=payload, headers=self.headers(origin="https://other.example.invalid")).status_code, 403)
        result = self.client.put("/v1/personal-states", json=payload, headers=self.headers())
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.json()["actor"], OWNER)

    def test_publication_requires_owner_write_boundary_and_literal_rights_acknowledgement(self):
        preview={"project_id":"synthetic","selections":[{"record_id":"synthetic:source"}]}
        approval={"preview_id":"publication-"+"a"*32,"expected_sha256":"b"*64,"expected_revision":0,"rationale":"Synthetic privacy and rights review","rights_checked":True}
        withdrawal={"project_id":"synthetic","expected_revision":1,"rationale":"Synthetic correction"}
        for path,payload in [("previews",preview),("approve",approval),("withdraw",withdrawal)]:
            route="/v1/publication/"+path
            self.assertEqual(self.client.post(route,json=payload).status_code,401)
            self.assertEqual(self.client.post(route,json=payload,headers=self.headers(sub="other")).status_code,403)
            headers=self.headers();headers.pop("x-research-write")
            self.assertEqual(self.client.post(route,json=payload,headers=headers).status_code,403)
            self.assertEqual(self.client.post(route,json=payload,headers=self.headers(origin="https://other.example.invalid")).status_code,403)
            result=self.client.post(route,json=payload,headers=self.headers())
            self.assertIn(result.status_code,(200,201));self.assertEqual(result.json()["actor"],OWNER)
            self.assertEqual(self.client.post(route,json={**payload,"actor":"forged-owner"},headers=self.headers()).status_code,422)
        for value in [False,0,1,"true",None]:
            self.assertEqual(self.client.post("/v1/publication/approve",json={**approval,"rights_checked":value},headers=self.headers()).status_code,422)
        self.assertEqual(self.client.post("/v1/publication/previews",json={**preview,"payload":{"private":"PRIVATE"}},headers=self.headers()).status_code,422)
        route="/v1/publication/relations";payload={"project_id":"synthetic","record_ids":["synthetic:source"]}
        self.assertEqual(self.client.post(route,json=payload).status_code,401)
        self.assertEqual(self.client.post(route,json=payload,headers=self.headers(sub="other")).status_code,403)
        self.assertEqual(self.client.post(route,json=payload,headers=self.headers()).json(),{"items":[],"truncated":False})

    def test_input_errors_do_not_echo_notes_and_payload_is_bounded(self):
        payload = {"record_id": "synthetic", "project_id": "synthetic", "note": "SYNTHETIC-PRIVATE-NOTE" * 1000}
        result = self.client.put("/v1/personal-states", json=payload, headers=self.headers())
        self.assertEqual(result.status_code, 422)
        self.assertNotIn("SYNTHETIC-PRIVATE-NOTE", result.text)
        result = self.client.put("/v1/personal-states", content=b"x"*65537, headers=self.headers())
        self.assertEqual(result.status_code, 413)
        self.assertEqual(result.headers["x-content-type-options"], "nosniff")

    def test_scripture_resolution_requires_owner_csrf_and_literal_confirmation(self):
        path="/v1/reading/scripture-citation"
        payload=dict(project_id="synthetic",annotation_id="synthetic:annotation",candidate_key="manual",
                     decision="confirmed",chapter=4,ayah_start=59,ayah_end=59,rationale="Private reference decision",
                     expected_revision=0,owner_confirmed=True)
        self.assertEqual(self.client.put(path,json=payload).status_code,401)
        self.assertEqual(self.client.put(path,json=payload,headers=self.headers(sub="other")).status_code,403)
        headers=self.headers();headers.pop("x-research-write")
        self.assertEqual(self.client.put(path,json=payload,headers=headers).status_code,403)
        result=self.client.put(path,json=payload,headers=self.headers())
        self.assertEqual(result.status_code,200)
        self.assertEqual(result.json()["actor"],OWNER)
        for patch in [{"owner_confirmed":value} for value in [False,0,1,"true",None]] + [{"actor":"forged"},{"matched_text":"forged"},{"chapter":True}]:
            self.assertEqual(self.client.put(path,json={**payload,**patch},headers=self.headers()).status_code,422)
        route="/v1/reading/scripture-candidates?project_id=synthetic&annotation_id=synthetic"
        self.assertEqual(self.client.get(route).status_code,401)
        self.assertEqual(self.client.get(route,headers=self.headers()).status_code,200)

    def test_lexicon_mutations_require_owner_confirmation_and_reject_unreviewed_state_promotion(self):
        payload=dict(request_uuid=str(uuid.uuid4()),project_id="synthetic",annotation_id="synthetic:annotation",start=0,end=6,
            entry=dict(scope="Synthetic entry scope",language_tag="ar-Latn"),concept=dict(mode="new",title="Synthetic concept",scope="Synthetic scope"),
            sense_scope="Only this synthetic passage",rationale="Synthetic explicit owner connection",owner_confirmed=True)
        path="/v1/lexicon/captures"
        self.assertEqual(self.client.post(path,json=payload).status_code,401)
        self.assertEqual(self.client.post(path,json=payload,headers=self.headers(sub="other")).status_code,403)
        headers=self.headers();headers.pop("x-research-write")
        self.assertEqual(self.client.post(path,json=payload,headers=headers).status_code,403)
        self.assertEqual(self.client.post(path,json=payload,headers=self.headers()).json()["actor"],OWNER)
        for patch in [{"owner_confirmed":value} for value in [False,0,1,"true",None]] + [{"actor":"forged"},{"review_state":"reviewed"},{"start":True}]:
            self.assertEqual(self.client.post(path,json={**payload,**patch},headers=self.headers()).status_code,422)
        self.assertEqual(self.client.post(path,json={**payload,"entry":{"scope":"Synthetic","actor":"forged"}},headers=self.headers()).status_code,422)

    def test_public_mode_has_no_owner_routes_or_mutations(self):
        public = TestClient(create_app(Settings("synthetic-not-a-live-dsn", mode="public"), store=MemoryBoundaryStore()))
        self.assertEqual(public.get("/v1/public/snapshots/test").status_code, 200)
        for path in ["/v1/projects", "/v1/personal-states", "/v1/records", "/v1/schema", "/openapi.json",
                     "/v1/evidence-path", "/v1/research-operations", "/v1/rank", "/v1/search", "/v1/personal-state",
                     "/v1/reading/documents", "/v1/reading/document", "/v1/reading/annotations", "/v1/reading/annotation",
                     "/v1/reading/scripture-candidates", "/v1/reading/scripture-citation", "/v1/reading/scripture-citations",
                     "/v1/lexicon/captures", "/v1/lexicon/representations", "/v1/lexicon/concept", "/v1/lexicon/senses",
                     "/v1/lexicon/definitions", "/v1/lexicon/definition", "/v1/lexicon/connection", "/v1/lexicon/occurrences", "/v1/lexicon/search",
                     "/v1/lexicon/entity", "/v1/lexicon/history",
                     "/v1/lexicon/annotation-links",
                     "/v1/publication/head", "/v1/publication/preview", "/v1/publication/previews", "/v1/publication/approve", "/v1/publication/withdraw", "/v1/publication/relations"]:
            self.assertEqual(public.get(path).status_code, 404)
            self.assertEqual(public.put(path, json={}).status_code, 404)
            self.assertEqual(public.post(path, json={}).status_code, 404)

    def test_graph_operations_are_owner_only_and_rank_inputs_are_explained(self):
        query = {"project_id": "synthetic", "record_id": "question", "profile_id": "question_evidence_trail"}
        self.assertEqual(self.client.get("/v1/evidence-path", params=query).status_code, 401)
        self.assertEqual(self.client.get("/v1/evidence-path", params=query, headers=self.headers()).status_code, 200)
        self.assertEqual(self.client.get("/v1/research-operations").status_code, 401)
        response = self.client.get("/v1/research-operations", headers=self.headers())
        self.assertEqual(len(response.json()["ranking_profiles"]), 5)
        payload = {"profile_id": "graph_degree", "candidates": [{"id": "synthetic", "features": {}}]}
        self.assertEqual(self.client.post("/v1/rank", json=payload).status_code, 401)
        result = self.client.post("/v1/rank", json=payload, headers=self.headers())
        self.assertEqual(result.status_code, 200)
        self.assertIsNone(result.json()["items"][0]["score"])
        payload["profile_id"] = "invented-profile"
        self.assertEqual(self.client.post("/v1/rank", json=payload, headers=self.headers()).status_code, 422)
        payload["profile_id"] = "graph_degree"
        payload["candidates"][0]["features"] = {"normalized_degree": {"value": True, "basis": "Synthetic"}}
        self.assertEqual(self.client.post("/v1/rank", json=payload, headers=self.headers()).status_code, 422)

    def test_search_requires_owner_and_private_note_scope_is_explicit(self):
        params = {"project_id": "synthetic", "q": "authority"}
        self.assertEqual(self.client.get("/v1/search", params=params).status_code, 401)
        result = self.client.get("/v1/search", params=params, headers=self.headers())
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.json()["scope"], "records")
        self.assertEqual(self.client.get("/v1/search", params={**params, "scope": "notes"}, headers=self.headers()).json()["scope"], "notes")
        self.assertEqual(self.client.get("/v1/search", params={**params, "scope": "annotations"}, headers=self.headers()).json()["scope"], "annotations")
        for extra in [{"scope": "public"}, {"limit": 1000}, {"q": ""}, {"q": "x"*501}]:
            self.assertEqual(self.client.get("/v1/search", params={**params, **extra}, headers=self.headers()).status_code, 422)

    def test_security_headers_and_schema(self):
        result = self.client.get("/v1/me", headers=self.headers())
        self.assertEqual(result.headers["cache-control"], "no-store")
        self.assertEqual(result.headers["x-frame-options"], "DENY")
        self.assertIn("x-request-id", result.headers)
        schema = self.client.get("/v1/schema", headers=self.headers()).json()
        self.assertIn("/v1/personal-states", schema["paths"])
        self.assertEqual(self.client.get("/v1/schema").status_code, 401)

    def test_unexpected_errors_are_redacted(self):
        def broken():
            raise RuntimeError("SYNTHETIC-PRIVATE-NOTE must never enter errors/logs")
        self.app = create_app(self.settings, store=MemoryBoundaryStore(), verifier=self.verifier)
        store = MemoryBoundaryStore()
        store.projects = broken
        with self.assertLogs("research.api", level="ERROR") as logs:
            result = TestClient(create_app(self.settings, store=store, verifier=self.verifier)).get("/v1/projects", headers=self.headers())
        self.assertNotIn("SYNTHETIC-PRIVATE-NOTE", " ".join(logs.output))
        self.assertEqual(result.status_code, 503)
        self.assertNotIn("SYNTHETIC-PRIVATE-NOTE", result.text)


@unittest.skipUnless(jwt and os.environ.get("RESEARCH_TEST_DATABASE_URL"), "Requires API extras and real PostgreSQL")
class APIDatabaseTests(unittest.TestCase):
    def test_real_source_intake_reopens_located_source_across_sessions_and_replays(self):
        from test_source_intake import payload
        dsn=os.environ["RESEARCH_TEST_DATABASE_URL"]
        with db.connect(dsn) as connection:db.migrate(connection)
        client=TestClient(create_app(Settings(dsn,owner_subject=OWNER,iap_audience=AUDIENCE,owner_origin=ORIGIN),verifier=self.verifier))
        other=TestClient(create_app(Settings(dsn,owner_subject=OWNER,iap_audience=AUDIENCE,owner_origin=ORIGIN),verifier=self.verifier))
        project="test:"+uuid.uuid4().hex
        self.assertEqual(client.post("/v1/projects",json={"project_id":project,"title":"Synthetic intake"},headers=self.headers()).status_code,201)
        values=payload(project,rights_status="permitted_excerpt",rights_basis="Authored synthetic fixture",coverage_scope="selected_passage",
            excerpt=dict(text="A synthetic source passage.",edition="Synthetic edition",locator="p. 3",representation_url=""))
        values.pop("actor")
        result=client.post("/v1/source-intakes",json=values,headers=self.headers())
        self.assertEqual(result.status_code,201,result.text);ids=result.json()
        again=other.post("/v1/source-intakes",json=values,headers=self.headers()).json()
        self.assertEqual(again["record_id"],ids["record_id"]);self.assertTrue(again["replayed"])
        record=other.get("/v1/record",params={"record_id":ids["record_id"]},headers=self.headers()).json()
        self.assertEqual(record["review_state"],"pending")
        document=other.get("/v1/reading/document",params={"project_id":project,"document_id":ids["document_id"]},headers=self.headers()).json()
        self.assertEqual(document["text_body"],values["excerpt"]["text"])
        history=other.get("/v1/source-intakes",params={"project_id":project,"source_record_id":ids["record_id"]},headers=self.headers()).json()["items"]
        self.assertEqual(history[0]["declarations"]["rights_basis"],values["rights_basis"])
        candidates=other.get("/v1/source-intakes/candidates",params={"project_id":project,"identifier":values["identifier"]},headers=self.headers()).json()["items"]
        self.assertEqual(candidates[0]["id"],ids["record_id"])
        self.assertEqual(other.get("/v1/reading/document",params={"project_id":"other","document_id":ids["document_id"]},headers=self.headers()).status_code,404)

    setUp = APIBoundaryTests.setUp
    headers = APIBoundaryTests.headers
    def test_lexicon_http_capture_definition_conflict_history_and_source_roundtrip(self):
        dsn=os.environ["RESEARCH_TEST_DATABASE_URL"]
        with db.connect(dsn) as connection: db.migrate(connection)
        settings=Settings(dsn,owner_subject=OWNER,iap_audience=AUDIENCE,owner_origin=ORIGIN)
        client=TestClient(create_app(settings,verifier=self.verifier))
        project,source="test:"+uuid.uuid4().hex,"test:"+uuid.uuid4().hex
        self.assertEqual(client.post("/v1/projects",json=dict(project_id=project,title="Synthetic lexicon HTTP project"),headers=self.headers()).status_code,201)
        self.assertEqual(client.put("/v1/records",json=dict(record_id=source,project_id=project,kind="source",title="Synthetic lexicon HTTP source"),headers=self.headers()).status_code,200)
        text="😀 tafsīr in a synthetic source."
        response=client.post("/v1/reading/documents",json=dict(project_id=project,source_record_id=source,edition="Synthetic edition",locator="Synthetic section 1",text=text),headers=self.headers())
        self.assertEqual(response.status_code,201);document=response.json()
        response=client.post("/v1/reading/annotations",json=dict(annotation_uuid=str(uuid.uuid4()),project_id=project,document_id=document["id"],text_sha256=document["text_sha256"],
            start=2,end=len(text),exact=text[2:],capture_kind="term_candidate"),headers=self.headers())
        self.assertEqual(response.status_code,201);annotation=response.json()
        payload=dict(request_uuid=str(uuid.uuid4()),project_id=project,annotation_id=annotation["id"],start=0,end=6,
            entry=dict(scope="Synthetic entry scope",language_tag="ar-Latn",script_tag="Latn"),concept=dict(mode="new",title="Synthetic concept",scope="A scope note, not a definition."),
            sense_scope="Only the synthetic fixture",rationale="Synthetic located connection",owner_confirmed=True)
        response=client.post("/v1/lexicon/captures",json=payload,headers=self.headers())
        self.assertEqual(response.status_code,201);capture=response.json()
        self.assertEqual(client.post("/v1/lexicon/captures",json=payload,headers=self.headers()).json(),capture)
        other=TestClient(create_app(settings,verifier=self.verifier))
        params=dict(project_id=project,concept_id=capture["concept_id"])
        self.assertTrue(other.get("/v1/lexicon/concept",params=params,headers=self.headers()).json()["definition_gap"])
        occurrence=other.get("/v1/lexicon/occurrences",params=params,headers=self.headers()).json()["items"][0]
        self.assertEqual(occurrence["exact"],"tafsīr");self.assertEqual(occurrence["annotation_id"],annotation["id"])
        self.assertEqual(occurrence["source_record_id"],source)
        links=other.get("/v1/lexicon/annotation-links",params=dict(project_id=project,annotation_id=annotation["id"]),headers=self.headers()).json()
        self.assertEqual(links["items"][0]["concept_id"],capture["concept_id"])
        self.assertEqual(links["items"][0]["link_kind"],"term_occurrence")
        self.assertEqual(other.get("/v1/lexicon/search",params=dict(project_id=project,q="tafsir"),headers=self.headers()).json()["items"][0]["id"],capture["concept_id"])
        definition=dict(definition_uuid=str(uuid.uuid4()),**params,sense_id=capture["sense_id"],annotation_id=annotation["id"],definition_kind="owner_paraphrase",
            wording_mode="paraphrase",body="Synthetic scoped definition paraphrase.",attribution="Synthetic owner",scope="Only the fixture",rationale="Synthetic unreviewed support",owner_confirmed=True)
        response=client.post("/v1/lexicon/definitions",json=definition,headers=self.headers())
        self.assertEqual(response.status_code,201);saved=response.json()
        self.assertEqual(saved["changed_by"],OWNER);self.assertEqual(saved["review_state"],"pending")
        self.assertFalse(other.get("/v1/lexicon/concept",params=params,headers=self.headers()).json()["definition_gap"])
        patch=dict(project_id=project,definition_id=saved["id"],expected_revision=1,wording_mode="paraphrase",body="Corrected synthetic scoped definition.",
            attribution="Synthetic owner",scope="A narrower fixture scope",dating_note="Unknown",rationale="Explicit synthetic correction",state="active",owner_confirmed=True)
        self.assertEqual(client.put("/v1/lexicon/definition",json=patch,headers=self.headers()).json()["revision"],2)
        conflict=other.put("/v1/lexicon/definition",json={**patch,"body":"Stale conflicting synthetic definition"},headers=self.headers())
        self.assertEqual(conflict.status_code,409);self.assertEqual(conflict.json()["current"]["body"],patch["body"])
        identity=dict(project_id=project,entity_kind="definition",entity_id=saved["id"])
        history=other.get("/v1/lexicon/history",params={**identity,"limit":1},headers=self.headers()).json()
        self.assertEqual(history["items"][0]["revision"],2);self.assertEqual(history["next_before_revision"],2)
        self.assertEqual(other.get("/v1/lexicon/history",params={**identity,"project_id":"other"},headers=self.headers()).status_code,404)
        self.assertEqual(other.get("/v1/lexicon/entity",params=identity,headers=self.headers()).json()["revision"],2)
        self.assertEqual(other.get("/v1/lexicon/occurrences",params={**params,"project_id":"other"},headers=self.headers()).json()["items"],[])

    def test_scripture_reference_roundtrip_detect_confirm_reload_reverse_and_export(self):
        dsn=os.environ["RESEARCH_TEST_DATABASE_URL"]
        with db.connect(dsn) as connection:
            db.migrate(connection)
        settings=Settings(dsn,owner_subject=OWNER,iap_audience=AUDIENCE,owner_origin=ORIGIN)
        client=TestClient(create_app(settings,verifier=self.verifier))
        project,source="test:"+uuid.uuid4().hex,"test:"+uuid.uuid4().hex
        self.assertEqual(client.post("/v1/projects",json={"project_id":project,"title":"Synthetic reference project"},headers=self.headers()).status_code,201)
        self.assertEqual(client.put("/v1/records",json=dict(record_id=source,project_id=project,kind="source",title="Synthetic citation source"),headers=self.headers()).status_code,200)
        text="In the Qur’an: verses 59 and 83 of chapter 4 (sūrat al-Nisā’)."
        response=client.post("/v1/reading/documents",json=dict(project_id=project,source_record_id=source,edition="Synthetic edition",locator="Abstract",text=text),headers=self.headers())
        self.assertEqual(response.status_code,201);document=response.json()
        response=client.post("/v1/reading/annotations",json=dict(annotation_uuid=str(uuid.uuid4()),project_id=project,
            document_id=document["id"],text_sha256=document["text_sha256"],start=0,end=len(text),exact=text,capture_kind="citation_candidate"),headers=self.headers())
        self.assertEqual(response.status_code,201);annotation=response.json()
        params=dict(project_id=project,annotation_id=annotation["id"])
        response=client.get("/v1/reading/scripture-candidates",params=params,headers=self.headers())
        self.assertEqual(response.status_code,200);detected=response.json()
        self.assertEqual({row["reference"]["ayah_start"] for row in detected["candidates"]},{59,83})
        self.assertEqual(detected["resolutions"],[])
        candidate=next(row for row in detected["candidates"] if row["reference"]["ayah_start"]==83)
        payload={**params,"candidate_key":candidate["key"],"decision":"confirmed","chapter":4,"ayah_start":83,"ayah_end":83,
                 "rationale":"Synthetic owner resolution; source interpretation unreviewed","expected_revision":0,"owner_confirmed":True}
        response=client.put("/v1/reading/scripture-citation",json=payload,headers=self.headers())
        self.assertEqual(response.status_code,200);self.assertEqual(response.json()["changed_by"],OWNER)
        other=TestClient(create_app(settings,verifier=self.verifier))
        reloaded=other.get("/v1/reading/scripture-candidates",params=params,headers=self.headers()).json()
        self.assertEqual(reloaded["resolutions"][0]["revision"],1)
        reverse=dict(project_id=project,chapter=4,ayah_start=83,ayah_end=83)
        found=other.get("/v1/reading/scripture-citations",params=reverse,headers=self.headers()).json()
        self.assertEqual(found["items"][0]["annotation_id"],annotation["id"])
        self.assertEqual(found["items"][0]["source_record_id"],source)
        self.assertEqual(other.get("/v1/reading/scripture-citations",params={**reverse,"project_id":"other"},headers=self.headers()).json()["items"],[])
        self.assertEqual(other.get("/v1/reading/scripture-candidates",params={**params,"project_id":"other"},headers=self.headers()).status_code,404)
        exported=other.get("/v1/reading/annotation",params=params,headers=self.headers()).json()["web_annotation"]
        self.assertEqual(exported["ir:scriptureReferences"][0]["ir:resolvedReference"]["id"],"urn:research:quran:tanzil-structure-1.0:4:83-83")

    def test_real_sessions_persist_notes_and_reject_stale_updates(self):
        dsn = os.environ["RESEARCH_TEST_DATABASE_URL"]
        with db.connect(dsn) as connection:
            db.migrate(connection)
        client = TestClient(create_app(Settings(dsn, owner_subject=OWNER, iap_audience=AUDIENCE,
                                               owner_origin=ORIGIN), verifier=self.verifier))
        project = "test:" + str(uuid.uuid4())
        response = client.post("/v1/projects", json={"project_id": project, "title": "Synthetic API project"}, headers=self.headers())
        self.assertEqual(response.status_code, 201)
        record = "test:" + str(uuid.uuid4())
        self.assertEqual(client.put("/v1/records", json=dict(record_id=record, project_id=project, kind="source", title="Synthetic source"), headers=self.headers()).status_code, 200)
        state = dict(record_id=record, project_id=project, reading="read", note="Synthetic durable note")
        self.assertEqual(client.put("/v1/personal-states", json=state, headers=self.headers()).status_code, 200)
        second = TestClient(create_app(Settings(dsn, owner_subject=OWNER, iap_audience=AUDIENCE,
                                               owner_origin=ORIGIN), verifier=self.verifier))
        rows = second.get("/v1/personal-states", params={"project_id": project}, headers=self.headers()).json()["items"]
        self.assertEqual(rows[0]["note"], state["note"])
        direct = second.get("/v1/personal-state", params={"project_id": project, "record_id": record}, headers=self.headers())
        self.assertEqual(direct.status_code, 200)
        self.assertEqual(direct.json()["note"], state["note"])
        self.assertEqual(second.get("/v1/personal-state", params={"project_id": "other", "record_id": record}, headers=self.headers()).status_code, 404)
        state.update(note="Synthetic newer note", expected_revision=1)
        self.assertEqual(second.put("/v1/personal-states", json=state, headers=self.headers()).status_code, 200)
        stale = client.put("/v1/personal-states", json=state, headers=self.headers())
        self.assertEqual(stale.status_code, 409)
        self.assertEqual(stale.json()["current"]["revision"], 2)
        # A public-mode service accidentally configured with admin credentials fails closed.
        public = TestClient(create_app(Settings(dsn, mode="public")))
        self.assertEqual(public.get("/health/ready").status_code, 503)
        self.assertEqual(public.get("/v1/public/snapshots/test").status_code, 503)

    def test_read_only_role_can_read_published_data_but_not_private_notes(self):
        from psycopg.conninfo import make_conninfo
        from islam_research import publication
        dsn = os.environ["RESEARCH_TEST_DATABASE_URL"]
        project_id = "synthetic-public-" + uuid.uuid4().hex
        with db.connect(dsn) as connection:
            db.migrate(connection)
            if not connection.execute("SELECT 1 FROM pg_roles WHERE rolname='research_ci_public'").fetchone():
                connection.execute("CREATE ROLE research_ci_public LOGIN")
            connection.execute("GRANT USAGE ON SCHEMA research_public TO research_ci_public")
            connection.execute("GRANT SELECT ON research_public.snapshots,research_public.publication_heads TO research_ci_public")
            db.create_project(connection, project_id, "Synthetic public snapshot")
            db.save_record(connection, record_id=project_id+":source", project_id=project_id,
                           kind="source", title="Synthetic source", actor="synthetic-owner")
            connection.commit()
            preview = publication.preview(connection, project_id=project_id,
                selections=[{"record_id": project_id+":source"}], relation_ids=[], actor="synthetic-owner")
            snapshot_id = preview["id"]
            publication.approve(connection, preview_id=snapshot_id, expected_sha256=preview["payload_sha256"],
                expected_revision=0, rationale="Synthetic rights review", actor="synthetic-owner", rights_checked=True)
        reader_dsn = make_conninfo(dsn, user="research_ci_public", password="")
        public = TestClient(create_app(Settings(reader_dsn, mode="public")))
        self.assertEqual(public.get("/health/ready").status_code, 200)
        result = public.get("/v1/public/snapshots/" + snapshot_id)
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.json()["payload"]["project"]["title"], "Synthetic public snapshot")
        self.assertEqual(public.put("/v1/personal-states", json={}).status_code, 404)
        with db.connect(reader_dsn) as connection:
            with self.assertRaises(Exception) as denied:
                connection.execute("SELECT * FROM research.personal_states")
            self.assertEqual(denied.exception.sqlstate, "42501")

    def test_markdown_roundtrip_uses_real_revision_safe_storage(self):
        import tempfile
        from pathlib import Path
        from islam_research.note_sync import SyncProblem, transfer
        from islam_research.note_format import parse_note
        dsn = os.environ["RESEARCH_TEST_DATABASE_URL"]
        with db.connect(dsn) as connection:
            db.migrate(connection)
        client = TestClient(create_app(Settings(dsn, owner_subject=OWNER, iap_audience=AUDIENCE,
                                               owner_origin=ORIGIN), verifier=self.verifier))
        project, record = "test:"+uuid.uuid4().hex, "test:"+uuid.uuid4().hex
        self.assertEqual(client.post("/v1/projects",json={"project_id":project,"title":"Synthetic note sync project"},headers=self.headers()).status_code,201)
        self.assertEqual(client.put("/v1/records",json={"record_id":record,"project_id":project,"kind":"source","title":"Synthetic source"},headers=self.headers()).status_code,200)
        headers = self.headers
        class SignedTestAdapter:
            def request(self,path,params=None,value=None):
                response = client.put("/v1/"+path,json=value,headers=headers()) if value is not None else client.get("/v1/"+path,params=params,headers=headers())
                if response.status_code >= 400:
                    raise SyncProblem(response.status_code,response.json().get("current"))
                return response.json()
        adapter = SignedTestAdapter()
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory).resolve()/"Synthetic source.md"
            transfer(adapter,path,"pull",apply=True,project_id=project,record_id=record)
            path.write_text(path.read_text()+"Synthetic offline note",encoding="utf-8")
            result = transfer(adapter,path,"push",apply=True)
            self.assertTrue(result["applied"])
            self.assertEqual(result["remote_revision"],1)
            self.assertFalse(parse_note(path.read_text())["locally_changed"])
            other = client.put("/v1/personal-states",json={"record_id":record,"project_id":project,"note":"Synthetic app edit","expected_revision":1},headers=self.headers())
            self.assertEqual(other.status_code,200)
            path.write_text(path.read_text()+" and another offline edit",encoding="utf-8")
            result = transfer(adapter,path,"push",apply=True)
            self.assertEqual(result["status"],"conflict")
            self.assertIn("Synthetic app edit",(path.parent/result["cloud_copy"]).read_text())
            self.assertEqual(client.get("/v1/personal-state",params={"project_id":project,"record_id":record},headers=self.headers()).json()["note"],"Synthetic app edit")

    def test_private_passage_capture_roundtrip_and_revision_conflict(self):
        dsn=os.environ["RESEARCH_TEST_DATABASE_URL"]
        with db.connect(dsn) as connection:
            db.migrate(connection)
        client=TestClient(create_app(Settings(dsn,owner_subject=OWNER,iap_audience=AUDIENCE,owner_origin=ORIGIN),verifier=self.verifier))
        project,source="test:"+uuid.uuid4().hex,"test:"+uuid.uuid4().hex
        self.assertEqual(client.post("/v1/projects",json={"project_id":project,"title":"Synthetic reader"},headers=self.headers()).status_code,201)
        self.assertEqual(client.put("/v1/records",json={"record_id":source,"project_id":project,"kind":"source","title":"Synthetic source"},headers=self.headers()).status_code,200)
        text="😀 PRIVATE EXCERPT MARKER "+"x"*100+" tafsīr "+"z"*100
        payload=dict(project_id=project,source_record_id=source,edition="Synthetic edition",locator="Abstract",text=text)
        self.assertEqual(client.post("/v1/reading/documents",json=payload).status_code,401)
        response=client.post("/v1/reading/documents",json=payload,headers=self.headers())
        self.assertEqual(response.status_code,201)
        document=response.json()
        self.assertEqual(client.get("/v1/reading/document",params={"project_id":"other","document_id":document["id"]},headers=self.headers()).status_code,404)
        start=text.index("tafsīr")
        capture=dict(annotation_uuid=str(uuid.uuid4()),project_id=project,document_id=document["id"],text_sha256=document["text_sha256"],start=start,end=start+6,exact="tafsīr",capture_kind="term_candidate",body="Synthetic personal definition question")
        bad=client.post("/v1/reading/annotations",json={**capture,"exact":"invented"},headers=self.headers())
        self.assertEqual(bad.status_code,422)
        response=client.post("/v1/reading/annotations",json=capture,headers=self.headers())
        self.assertEqual(response.status_code,201)
        captured=response.json()
        bundle=client.get("/v1/reading/annotation",params={"project_id":project,"annotation_id":captured["id"]},headers=self.headers()).json()
        self.assertTrue(bundle["anchor"]["anchored"])
        self.assertNotIn("PRIVATE EXCERPT MARKER",json.dumps(bundle["web_annotation"]))
        update=dict(annotation_id=captured["id"],project_id=project,body="Updated private question",expected_revision=1)
        self.assertEqual(client.put("/v1/reading/annotation",json=update,headers=self.headers()).status_code,200)
        self.assertEqual(client.put("/v1/reading/annotation",json=update,headers=self.headers()).status_code,409)
        self.assertEqual(client.get("/v1/reading/document",params={"project_id":project,"document_id":document["id"]}).status_code,401)
