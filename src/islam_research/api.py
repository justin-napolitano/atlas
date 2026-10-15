"""Single-owner research API with a distinct read-only public runtime mode."""
from __future__ import annotations

import asyncio
from collections import deque
import json
import logging
import os
import time
import uuid
from dataclasses import dataclass, field
from typing import Annotated, Literal
from urllib.parse import urlsplit

from fastapi import APIRouter, Depends, FastAPI, HTTPException, Query, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, field_validator
from psycopg import IntegrityError

from .api_auth import IAPVerifier, IdentityUnavailable, InvalidIdentity
from .api_store import PostgreSQLStore
from .database import RevisionConflict
from .graph_engine import rank, registered_policy

logger = logging.getLogger("research.api")
Identifier = Annotated[str, Field(min_length=1, max_length=500, pattern=r"^[^\x00-\x1f\x7f]+$")]


@dataclass(frozen=True)
class Settings:
    """Fail closed on missing owner identity, origin, audience, or storage config."""
    database_url: str = field(repr=False)
    mode: str = "owner"
    owner_subject: str = field(default="", repr=False)
    iap_audience: str = ""
    owner_origin: str = ""

    def __post_init__(self):
        if not self.database_url or self.mode not in {"owner", "public"}:
            raise ValueError("Database configuration and an explicit supported mode are required")
        if self.mode == "owner":
            origin = urlsplit(self.owner_origin)
            if not self.owner_subject or not self.iap_audience.startswith("/projects/"):
                raise ValueError("Configure the stable owner subject and IAP audience")
            if origin.scheme != "https" or not origin.netloc or origin.path or origin.query or origin.fragment or origin.username:
                raise ValueError("Configure one exact HTTPS owner origin")

    @classmethod
    def from_env(cls):
        return cls(database_url=os.environ.get("RESEARCH_DATABASE_URL", ""),
                   mode=os.environ.get("RESEARCH_MODE", "owner"),
                   owner_subject=os.environ.get("RESEARCH_OWNER_SUBJECT", ""),
                   iap_audience=os.environ.get("RESEARCH_IAP_AUDIENCE", ""),
                   owner_origin=os.environ.get("RESEARCH_OWNER_ORIGIN", ""))


class Input(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class ProjectInput(Input):
    project_id: Identifier
    title: Annotated[str, Field(min_length=1, max_length=2000)]
    scope: Annotated[str, Field(max_length=10000)] = ""


class RecordInput(Input):
    record_id: Identifier
    project_id: Identifier
    kind: Identifier
    title: Annotated[str, Field(min_length=1, max_length=2000)]
    summary: Annotated[str, Field(max_length=50000)] = ""
    attributes: dict = Field(default_factory=dict)
    expected_revision: Annotated[int, Field(ge=0)] = 0


class PersonalInput(Input):
    record_id: Identifier
    project_id: Identifier
    reading: Literal["unread", "reading", "read"] = "unread"
    decision: Literal["unreviewed", "relevant", "not_relevant", "read_later"] = "unreviewed"
    note: Annotated[str, Field(max_length=10000)] = ""
    expected_revision: Annotated[int, Field(ge=0)] = 0


class FeatureInput(Input):
    value: Annotated[float, Field(ge=0, le=1, allow_inf_nan=False)] | None = None
    basis: Annotated[str, Field(max_length=2000)] = ""


class RankCandidate(Input):
    id: Identifier
    features: dict[str, FeatureInput] = Field(max_length=12)


class RankInput(Input):
    profile_id: Identifier
    candidates: list[RankCandidate] = Field(max_length=100)


class ReadingDocumentInput(Input):
    project_id: Identifier
    source_record_id: Identifier
    edition: Annotated[str, Field(min_length=1,max_length=1000)]
    locator: Annotated[str, Field(min_length=1,max_length=2000)]
    representation_url: Annotated[str, Field(max_length=2000)] = ""
    text: Annotated[str, Field(min_length=1,max_length=12000)]


class ReadingCaptureInput(Input):
    annotation_uuid: Annotated[str, Field(pattern=r"^[a-fA-F0-9-]{36}$")]
    project_id: Identifier
    document_id: Identifier
    text_sha256: Annotated[str, Field(pattern=r"^[a-f0-9]{64}$")]
    start: Annotated[int, Field(ge=0,le=12000)]
    end: Annotated[int, Field(ge=1,le=12000)]
    exact: Annotated[str, Field(min_length=1,max_length=500)]
    capture_kind: Literal["comment","term_candidate","citation_candidate"] = "comment"
    body: Annotated[str, Field(max_length=10000)] = ""


class ReadingAnnotationUpdate(Input):
    annotation_id: Identifier
    project_id: Identifier
    body: Annotated[str, Field(max_length=10000)]
    expected_revision: Annotated[int, Field(ge=1)]


class ScriptureResolutionInput(Input):
    project_id: Identifier
    annotation_id: Identifier
    candidate_key: Annotated[str, Field(pattern=r"^(manual|[a-f0-9]{64})$")]
    decision: Literal["confirmed","dismissed"]
    chapter: Annotated[int, Field(ge=1,le=114)] | None = None
    ayah_start: Annotated[int, Field(ge=1,le=286)] | None = None
    ayah_end: Annotated[int, Field(ge=1,le=286)] | None = None
    rationale: Annotated[str, Field(min_length=1,max_length=2000)]
    expected_revision: Annotated[int, Field(ge=0)]
    owner_confirmed: bool

    @field_validator("owner_confirmed")
    @classmethod
    def explicit_resolution(cls,value):
        if value is not True:
            raise ValueError("Explicit owner reference decision required")
        return value


class PublicationSelection(Input):
    record_id: Identifier
    include_summary: bool = False
    include_bibliography: bool = False


class PublicationPreviewInput(Input):
    project_id: Identifier
    selections: list[PublicationSelection] = Field(min_length=1,max_length=100)
    relation_ids: list[Identifier] = Field(default_factory=list,max_length=300)


class PublicationRelationsInput(Input):
    project_id: Identifier
    record_ids: list[Identifier] = Field(min_length=1,max_length=100)


class PublicationApprovalInput(Input):
    preview_id: Annotated[str,Field(pattern=r"^publication-[a-f0-9]{32}$")]
    expected_sha256: Annotated[str,Field(pattern=r"^[a-f0-9]{64}$")]
    expected_revision: Annotated[int,Field(ge=0)]
    rationale: Annotated[str,Field(min_length=1,max_length=2000)]
    rights_checked: Annotated[bool,Field(strict=True)]

    @field_validator("rights_checked")
    @classmethod
    def explicit_rights_acknowledgement(cls,value):
        if value is not True:
            raise ValueError("Explicit rights and privacy review required")
        return value


class PublicationWithdrawalInput(Input):
    project_id: Identifier
    expected_revision: Annotated[int,Field(ge=1)]
    rationale: Annotated[str,Field(min_length=1,max_length=2000)]


def problem(status: int, detail: str, request_id: str = "", **extra) -> JSONResponse:
    return JSONResponse(status_code=status, media_type="application/problem+json",
                        content=jsonable_encoder({"type": "about:blank", "status": status,
                                                  "detail": detail, "request_id": request_id, **extra}))


class RequestBoundary:
    """Bound streamed bodies/time and attach API headers without logging research text."""
    def __init__(self, app, requests_per_minute=120):
        self.app = app
        self.recent = deque()
        self.requests_per_minute = requests_per_minute

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        started = time.monotonic()
        request_id = uuid.uuid4().hex
        scope.setdefault("state", {})["request_id"] = request_id
        status = 500
        response_started = False
        async def wrapped_send(message):
            nonlocal status, response_started
            if message["type"] == "http.response.start":
                status = message["status"]
                response_started = True
                message["headers"] = list(message.get("headers", [])) + [
                    (b"cache-control", b"no-store"), (b"x-request-id", request_id.encode()),
                    (b"x-content-type-options", b"nosniff"), (b"x-frame-options", b"DENY"),
                    (b"referrer-policy", b"no-referrer"),
                    (b"strict-transport-security", b"max-age=31536000"),
                    (b"content-security-policy", b"default-src 'none'; frame-ancestors 'none'"),
                    (b"permissions-policy", b"camera=(), microphone=(), geolocation=()")]
            await send(message)
        if scope.get("path") != "/health/live":
            now = time.monotonic()
            while self.recent and self.recent[0] < now - 60:
                self.recent.popleft()
            if len(self.recent) >= self.requests_per_minute:
                return await problem(429, "Request limit reached; retry shortly", request_id)(scope, receive, wrapped_send)
            self.recent.append(now)
        chunks, size = [], 0
        try:
            while True:
                message = await asyncio.wait_for(receive(), timeout=5)
                if message["type"] == "http.disconnect":
                    return
                chunk = message.get("body", b"")
                size += len(chunk)
                if size > 65536:
                    return await problem(413, "Request body exceeds 64 KiB", request_id)(scope, receive, wrapped_send)
                chunks.append(chunk)
                if not message.get("more_body", False):
                    break
        except asyncio.TimeoutError:
            return await problem(408, "Request body timed out", request_id)(scope, receive, wrapped_send)
        delivered = False
        async def replay():
            nonlocal delivered
            if delivered:
                return await receive()
            delivered = True
            return {"type": "http.request", "body": b"".join(chunks), "more_body": False}
        try:
            await self.app(scope, replay, wrapped_send)
        except Exception as error:
            logger.error(json.dumps({"event": "request_failed", "request_id": request_id,
                                     "error_type": type(error).__name__}))
            if not response_started:
                await problem(503, "Research service unavailable; retry without discarding your draft", request_id)(scope, replay, wrapped_send)
        finally:
            route = getattr(scope.get("route"), "path", "unmatched")
            logger.info(json.dumps({"event": "http_request", "service": "research-api",
                                   "version": os.environ.get("RESEARCH_VERSION", "development"),
                                   "request_id": request_id, "method": scope["method"],
                                   "route": route, "status": status,
                                   "duration_ms": round((time.monotonic() - started) * 1000)}))


def create_app(settings: Settings | None = None, *, store=None, verifier=None) -> FastAPI:
    """Build the owner/public API; test adapters are Python injections, not env bypasses."""
    settings = settings or Settings.from_env()
    store = store or PostgreSQLStore(settings.database_url)
    verifier = verifier or IAPVerifier(settings.iap_audience, settings.owner_subject)
    app = FastAPI(title="Research workspace API", version="0.1.0",
                  docs_url=None, redoc_url=None, openapi_url=None)
    app.add_middleware(RequestBoundary, requests_per_minute=120 if settings.mode == "owner" else 600)

    @app.exception_handler(HTTPException)
    async def http_error(request, error):
        return problem(error.status_code, str(error.detail), request.state.request_id)

    @app.exception_handler(RequestValidationError)
    async def validation_error(request, error):
        # Pydantic's default error includes submitted input, potentially private notes.
        fields = [{"field": ".".join(map(str, e["loc"])), "type": e["type"]} for e in error.errors()]
        return problem(422, "Invalid request fields", request.state.request_id, errors=fields)

    @app.exception_handler(RevisionConflict)
    async def conflict(request, error):
        return problem(409, "Record changed; resolve the current revision", request.state.request_id,
                       current=error.current)

    @app.exception_handler(IntegrityError)
    async def integrity_error(request, error):
        return problem(409, "The request conflicts with a research record constraint", request.state.request_id)

    @app.exception_handler(ValueError)
    async def value_error(request, error):
        return problem(422, "Invalid research record", request.state.request_id)

    @app.get("/health/live")
    def live():
        return {"status": "alive"}

    @app.get("/health/ready")
    def ready():
        try:
            available = store.ready(settings.mode)
        except Exception:
            available = False
        if not available:
            raise HTTPException(503, "Research storage is not ready")
        return {"status": "ready"}

    if settings.mode == "public":
        @app.get("/v1/public/snapshots/{snapshot_id}")
        def published(snapshot_id: Annotated[str, Field(min_length=1, max_length=100, pattern=r"^[a-zA-Z0-9._-]+$")]):
            result = store.published(snapshot_id)
            if result is None:
                raise HTTPException(404, "Published snapshot not found")
            return result
        return app

    def owner(request: Request) -> str:
        try:
            subject = verifier.verify(request.headers.get("x-goog-iap-jwt-assertion", ""))
        except InvalidIdentity:
            raise HTTPException(401, "Verified owner sign-in required") from None
        except PermissionError:
            raise HTTPException(403, "Owner access required") from None
        except IdentityUnavailable:
            raise HTTPException(503, "Identity verification unavailable") from None
        if request.method not in {"GET", "HEAD", "OPTIONS"}:
            if request.headers.get("x-research-write") != "1":
                raise HTTPException(403, "Explicit research write header required")
            origin = request.headers.get("origin")
            if origin and origin != settings.owner_origin:
                raise HTTPException(403, "Owner origin required")
            if request.headers.get("content-type", "").split(";")[0] != "application/json":
                raise HTTPException(415, "JSON input required")
        return subject

    router = APIRouter(prefix="/v1", dependencies=[Depends(owner)])

    @router.get("/me")
    def me():
        return {"mode": "owner", "can_edit": True}

    @router.get("/projects")
    def projects():
        return {"items": store.projects()}

    @router.post("/projects", status_code=201)
    def create_project(value: ProjectInput):
        return store.create_project(**value.model_dump())

    @router.get("/records")
    def records(project_id: Identifier, kind: Identifier | None = None,
                cursor: Annotated[str, Query(max_length=500)] = "", limit: Annotated[int, Query(ge=1, le=100)] = 50):
        rows = store.records(project_id, kind, cursor, limit + 1)
        return {"items": rows[:limit], "next_cursor": rows[limit - 1]["id"] if len(rows) > limit else None}

    @router.get("/record")
    def record(record_id: Identifier):
        value = store.record(record_id)
        if value is None:
            raise HTTPException(404, "Record not found")
        return value

    @router.put("/records")
    def put_record(value: RecordInput, actor: str = Depends(owner)):
        return store.save_record(actor=actor, **value.model_dump())

    @router.get("/personal-states")
    def states(project_id: Identifier, cursor: Annotated[str, Query(max_length=500)] = "",
               limit: Annotated[int, Query(ge=1, le=100)] = 50):
        rows = store.states(project_id, cursor, limit + 1)
        return {"items": rows[:limit], "next_cursor": rows[limit - 1]["record_id"] if len(rows) > limit else None}

    @router.put("/personal-states")
    def put_state(value: PersonalInput, actor: str = Depends(owner)):
        return store.save_state(actor=actor, **value.model_dump())

    @router.get("/personal-state")
    def personal_state(project_id: Identifier, record_id: Identifier):
        result = store.state(project_id, record_id)
        if result is None:
            raise HTTPException(404, "Personal state not yet recorded")
        return result

    @router.get("/research-operations")
    def operations():
        policy, digest = registered_policy()
        return {"policy_sha256": digest, "traversal_profiles": policy["traversal_profiles"],
                "ranking_profiles": policy["ranking_profiles"],
                "execution": "typed_traversal_and_owner_observation_scoring_v1"}

    @router.get("/search")
    def search(project_id: Identifier, q: Annotated[str, Query(min_length=1, max_length=500)],
               scope: Literal["records", "notes", "annotations", "all"] = "records", kind: Identifier | None = None,
               limit: Annotated[int, Query(ge=1, le=100)] = 30):
        return store.search(project_id, q, scope, kind, limit)

    @router.get("/evidence-path")
    def evidence_path(project_id: Identifier, record_id: Identifier, profile_id: Identifier):
        result = store.evidence_path(project_id, record_id, profile_id)
        if result is None:
            raise HTTPException(404, "Start record not found in the selected project")
        return result

    @router.post("/rank")
    def ranking(value: RankInput):
        return rank(value.profile_id, [c.model_dump() for c in value.candidates])

    @router.get("/schema")
    def schema():
        return app.openapi()

    @router.get("/reading/documents")
    def reading_documents(project_id: Identifier, source_record_id: Identifier,
                          cursor: Annotated[str, Query(max_length=500)] = "",limit: Annotated[int, Query(ge=1,le=50)] = 25):
        rows = store.reading_documents(project_id,source_record_id,cursor,limit+1)
        return {"items":rows[:limit],"next_cursor":rows[limit-1]["id"] if len(rows)>limit else None}

    @router.post("/reading/documents",status_code=201)
    def create_reading_document(value: ReadingDocumentInput, actor: str = Depends(owner)):
        return store.create_reading_document(actor=actor,**value.model_dump())

    @router.get("/reading/document")
    def reading_document(project_id: Identifier, document_id: Identifier):
        value = store.reading_document(project_id,document_id)
        if value is None:
            raise HTTPException(404,"Reading snapshot not found")
        return value

    @router.get("/reading/annotations")
    def reading_annotations(project_id: Identifier, document_id: Identifier,
                            cursor: Annotated[str, Query(max_length=500)] = "",limit: Annotated[int, Query(ge=1,le=100)] = 50):
        rows = store.reading_annotations(project_id,document_id,cursor,limit+1)
        return {"items":rows[:limit],"next_cursor":rows[limit-1]["id"] if len(rows)>limit else None}

    @router.post("/reading/annotations",status_code=201)
    def create_reading_annotation(value: ReadingCaptureInput, actor: str = Depends(owner)):
        return store.create_reading_annotation(actor=actor,**value.model_dump())

    @router.get("/reading/annotation")
    def reading_annotation(project_id: Identifier, annotation_id: Identifier):
        value = store.reading_annotation(project_id,annotation_id)
        if value is None:
            raise HTTPException(404,"Reading annotation not found")
        return value

    @router.put("/reading/annotation")
    def update_reading_annotation(value: ReadingAnnotationUpdate, actor: str = Depends(owner)):
        return store.update_reading_annotation(actor=actor,**value.model_dump())

    @router.get("/reading/scripture-candidates")
    def scripture_candidates(project_id: Identifier, annotation_id: Identifier):
        value = store.scripture_candidates(project_id,annotation_id)
        if value is None:
            raise HTTPException(404,"Reading annotation not found")
        return value

    @router.put("/reading/scripture-citation")
    def resolve_scripture_citation(value: ScriptureResolutionInput, actor: str = Depends(owner)):
        return store.resolve_scripture_citation(actor=actor,**value.model_dump(exclude={"owner_confirmed"}))

    @router.get("/reading/scripture-citations")
    def scripture_citations(project_id: Identifier, chapter: Annotated[int,Query(ge=1,le=114)],
                            ayah_start: Annotated[int,Query(ge=1,le=286)],
                            ayah_end: Annotated[int,Query(ge=1,le=286)],
                            cursor: Annotated[str,Query(max_length=500)] = "",
                            limit: Annotated[int,Query(ge=1,le=25)] = 25):
        rows = store.scripture_citations(project_id,chapter,ayah_start,ayah_end,cursor,limit+1)
        return {"items":rows[:limit],"next_cursor":rows[limit-1]["id"] if len(rows)>limit else None}

    @router.get("/publication/head")
    def publication_head(project_id: Identifier):
        return store.publication_head(project_id)

    @router.get("/publication/preview")
    def publication_preview_by_id(project_id: Identifier,preview_id: Identifier):
        value=store.publication_preview_by_id(project_id,preview_id)
        if value is None:
            raise HTTPException(404,"Publication preview not found")
        return value

    @router.post("/publication/previews",status_code=201)
    def publication_preview(value: PublicationPreviewInput,actor: str = Depends(owner)):
        return store.publication_preview(actor=actor,**value.model_dump())

    @router.post("/publication/relations")
    def publication_relations(value: PublicationRelationsInput):
        return store.publication_relations(**value.model_dump())

    @router.post("/publication/approve")
    def publication_approve(value: PublicationApprovalInput,actor: str = Depends(owner)):
        return store.publication_approve(actor=actor,**value.model_dump())

    @router.post("/publication/withdraw")
    def publication_withdraw(value: PublicationWithdrawalInput,actor: str = Depends(owner)):
        return store.publication_withdraw(actor=actor,**value.model_dump())

    app.include_router(router)
    return app
