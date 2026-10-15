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

    def test_input_errors_do_not_echo_notes_and_payload_is_bounded(self):
        payload = {"record_id": "synthetic", "project_id": "synthetic", "note": "SYNTHETIC-PRIVATE-NOTE" * 1000}
        result = self.client.put("/v1/personal-states", json=payload, headers=self.headers())
        self.assertEqual(result.status_code, 422)
        self.assertNotIn("SYNTHETIC-PRIVATE-NOTE", result.text)
        result = self.client.put("/v1/personal-states", content=b"x"*65537, headers=self.headers())
        self.assertEqual(result.status_code, 413)
        self.assertEqual(result.headers["x-content-type-options"], "nosniff")

    def test_public_mode_has_no_owner_routes_or_mutations(self):
        public = TestClient(create_app(Settings("synthetic-not-a-live-dsn", mode="public"), store=MemoryBoundaryStore()))
        self.assertEqual(public.get("/v1/public/snapshots/test").status_code, 200)
        for path in ["/v1/projects", "/v1/personal-states", "/v1/records", "/v1/schema", "/openapi.json",
                     "/v1/evidence-path", "/v1/research-operations", "/v1/rank", "/v1/search"]:
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
    setUp = APIBoundaryTests.setUp
    headers = APIBoundaryTests.headers
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
        dsn = os.environ["RESEARCH_TEST_DATABASE_URL"]
        snapshot_id = "synthetic-" + uuid.uuid4().hex
        with db.connect(dsn) as connection:
            db.migrate(connection)
            if not connection.execute("SELECT 1 FROM pg_roles WHERE rolname='research_ci_public'").fetchone():
                connection.execute("CREATE ROLE research_ci_public LOGIN")
            connection.execute("GRANT USAGE ON SCHEMA research_public TO research_ci_public")
            connection.execute("GRANT SELECT ON research_public.snapshots TO research_ci_public")
            connection.execute("INSERT INTO research_public.snapshots(id,project_id,payload) VALUES (%s,%s,%s::jsonb)",
                               (snapshot_id, "synthetic-published-project", json.dumps({"nodes": [], "title": "Synthetic public snapshot"})))
        reader_dsn = make_conninfo(dsn, user="research_ci_public", password="")
        public = TestClient(create_app(Settings(reader_dsn, mode="public")))
        self.assertEqual(public.get("/health/ready").status_code, 200)
        result = public.get("/v1/public/snapshots/" + snapshot_id)
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.json()["payload"]["title"], "Synthetic public snapshot")
        self.assertEqual(public.put("/v1/personal-states", json={}).status_code, 404)
        with db.connect(reader_dsn) as connection:
            with self.assertRaises(Exception) as denied:
                connection.execute("SELECT * FROM research.personal_states")
            self.assertEqual(denied.exception.sqlstate, "42501")
