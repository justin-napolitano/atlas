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
from .quran_citations import PARSER_VERSION as QURAN_PARSER_VERSION, PROFILE_ID as QURAN_PROFILE_ID
from .quran_resources import pilot_resource
from .quran_reader_candidate import chapter_resource
from .reader_collection import collection_resource
from . import quran_reader, quran_words, gutenberg

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
    project_id: Identifier | None = None
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
    project_id: Identifier | None = None
    source_record_id: Identifier
    edition: Annotated[str, Field(min_length=1,max_length=1000)]
    locator: Annotated[str, Field(min_length=1,max_length=2000)]
    representation_url: Annotated[str, Field(max_length=2000)] = ""
    text: Annotated[str, Field(min_length=1,max_length=12000)]
    source_notice: Annotated[str, Field(max_length=8000)] = ""


class ReadingCaptureInput(Input):
    annotation_uuid: Annotated[str, Field(pattern=r"^[a-fA-F0-9-]{36}$")]
    project_id: Identifier | None = None
    document_id: Identifier
    text_sha256: Annotated[str, Field(pattern=r"^[a-f0-9]{64}$")]
    start: Annotated[int, Field(ge=0,le=12000)]
    end: Annotated[int, Field(ge=1,le=12000)]
    exact: Annotated[str, Field(min_length=1,max_length=500)]
    capture_kind: Literal["comment","term_candidate","citation_candidate"] = "comment"
    mark_style: Literal["highlight","underline","none"] = "highlight"
    body: Annotated[str, Field(max_length=10000)] = ""


class SourceIntakeExcerpt(Input):
    edition: Annotated[str, Field(min_length=1,max_length=1000)]
    locator: Annotated[str, Field(min_length=1,max_length=2000)]
    representation_url: Annotated[str, Field(max_length=2000)] = ""
    text: Annotated[str, Field(min_length=1,max_length=12000)]


class SourceIntakeInput(Input):
    intake_uuid: Annotated[str, Field(pattern=r"^[a-fA-F0-9-]{36}$")]
    project_id: Identifier
    title: Annotated[str, Field(min_length=1,max_length=2000)]
    creators: Annotated[str, Field(max_length=2000)] = ""
    publication: Annotated[str, Field(max_length=2000)] = ""
    publication_date: Annotated[str, Field(max_length=200)] = ""
    language: Annotated[str, Field(max_length=200)] = ""
    accessed_on: Annotated[str, Field(max_length=10)] = ""
    intake_context: Annotated[str, Field(max_length=2000)] = ""
    edition: Annotated[str, Field(min_length=1,max_length=1000)]
    identifier: Annotated[str, Field(max_length=2000)] = ""
    source_url: Annotated[str, Field(max_length=2000)] = ""
    source_role: Literal["primary_text","translation","commentary","scholarship","reference","undetermined"] = "undetermined"
    access_status: Literal["unknown","open","subscription","owned_copy","unavailable"] = "unknown"
    rights_status: Literal["unknown","metadata_only","permitted_excerpt","public_domain","open_license"] = "metadata_only"
    rights_basis: Annotated[str, Field(max_length=2000)] = ""
    coverage_scope: Literal["metadata_only","abstract","selected_passage","full_work_read"] = "metadata_only"
    rationale: Annotated[str, Field(min_length=1,max_length=2000)]
    distinct_source_rationale: Annotated[str, Field(max_length=2000)] = ""
    existing_source_record_id: Identifier | None = None
    excerpt: SourceIntakeExcerpt | None = None
    owner_confirmed: Literal[True]

    @field_validator("owner_confirmed",mode="before")
    @classmethod
    def literal_owner_confirmation(cls, value):
        if value is not True:
            raise ValueError("Explicit owner confirmation is required")
        return value


class ReadingAnnotationUpdate(Input):
    annotation_id: Identifier
    project_id: Identifier | None = None
    body: Annotated[str, Field(max_length=10000)]
    expected_revision: Annotated[int, Field(ge=1)]
    mark_style: Literal["highlight","underline","none"] | None = None


class ReadingDraftInput(Input):
    draft_uuid: Annotated[str,Field(pattern=r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")]
    project_id: Identifier | None = None
    record_id: Identifier
    context_kind: Literal["record_note","capture","annotation"]
    document_id: Identifier | None = None
    annotation_id: Identifier | None = None
    text_sha256: Annotated[str,Field(pattern=r"^[0-9a-f]{64}$")] | None = None
    start: Annotated[int,Field(ge=0,le=12000)] | None = None
    end: Annotated[int,Field(ge=1,le=12000)] | None = None
    exact: Annotated[str,Field(max_length=500)] = ""
    capture_kind: Literal["comment","term_candidate","citation_candidate"] | None = None
    base_revision: Annotated[int,Field(ge=0)]
    body: Annotated[str,Field(max_length=10000)]
    mark_style: Literal["highlight","underline","none"] = "none"
    state: Literal["active","discarded"] = "active"
    expected_revision: Annotated[int,Field(ge=0)]


class ReadingDeskInput(Input):
    project_id: Identifier | None = None
    record_id: Identifier
    document_id: Identifier | None = None
    annotation_id: Identifier | None = None
    start: Annotated[int,Field(ge=0,le=12000)] | None = None
    end: Annotated[int,Field(ge=0,le=12000)] | None = None
    expected_revision: Annotated[int,Field(ge=0)]


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


class VerseOwnerInput(Input):
    owner_confirmed: bool

    @field_validator("owner_confirmed")
    @classmethod
    def explicit_material_choice(cls,value):
        if value is not True: raise ValueError("Explicit owner material choice required")
        return value


class VerseMetadata(VerseOwnerInput):
    attribution: Annotated[str,Field(min_length=1,max_length=2000)]
    language_tag: Annotated[str,Field(min_length=1,max_length=100)] = "und"
    source_scope: Annotated[str,Field(min_length=1,max_length=10000)]
    assertion_mode: Literal["none","quotation","paraphrase"] = "none"
    assertion_text: Annotated[str,Field(max_length=5000)] = ""
    reading_note: Annotated[str,Field(max_length=2000)] = ""
    period_note: Annotated[str,Field(max_length=2000)] = ""
    tradition_note: Annotated[str,Field(max_length=2000)] = ""
    context_basis: Annotated[str,Field(max_length=2000)] = ""
    rationale: Annotated[str,Field(min_length=1,max_length=2000)]
    state: Literal["active","withdrawn"] = "active"


class VersePilotImport(VerseOwnerInput):
    request_uuid: Annotated[str,Field(pattern=r"^[a-fA-F0-9-]{36}$")]
    project_id: Identifier
    chapter: Annotated[int,Field(ge=1,le=114)]
    ayah: Annotated[int,Field(ge=1,le=286)]
    rationale: Annotated[str,Field(min_length=1,max_length=2000)]


class QuranBinding(VerseOwnerInput):
    note_scope: Literal['verse','surah','source'] = 'verse'
    project_id: Identifier | None = None
    resource_key: Literal['tanzil-uthmani','itani-god']
    chapter: Annotated[int,Field(ge=1,le=114)]
    ayah_start: Annotated[int,Field(ge=1,le=286)]
    ayah_end: Annotated[int,Field(ge=1,le=286)]


class QuranNote(QuranBinding):
    request_uuid: Annotated[str,Field(min_length=36,max_length=36)]
    body: Annotated[str,Field(min_length=1,max_length=20000)]


class QuranPlace(VerseOwnerInput):
    project_id: Identifier | None = None
    resource_key: Literal['tanzil-uthmani','itani-god']
    chapter: Annotated[int,Field(ge=1,le=114)]
    ayah: Annotated[int,Field(ge=1,le=286)]
    expected_revision: Annotated[int,Field(ge=0)]


class QuranProgress(VerseOwnerInput):
    project_id: Identifier | None = None
    chapter: Annotated[int,Field(ge=1,le=114)]
    ayah: Annotated[int,Field(ge=1,le=286)]
    is_read: bool
    expected_revision: Annotated[int,Field(ge=0)]
class QuranReaderAssociation(Input):
    project_id: Identifier
    chapter: Annotated[int,Field(ge=1,le=114)]
    ayah: Annotated[int,Field(ge=1,le=286)]
    resource_id: Identifier
    text_sha256: Annotated[str,Field(pattern=r"^[a-f0-9]{64}$")]
    translation_key: Literal["english_saheeh", "english_rwwad"] = "english_saheeh"


class CollectionReadingLink(VerseOwnerInput):
    project_id: Identifier
    reading_id: Identifier
    document_id: Identifier
    request_uuid: Annotated[str,Field(pattern=r"^[a-fA-F0-9-]{36}$")]
    rationale: Annotated[str,Field(min_length=1,max_length=2000)]


class VerseMaterialInput(VerseMetadata):
    request_uuid: Annotated[str,Field(pattern=r"^[a-fA-F0-9-]{36}$")]
    project_id: Identifier
    annotation_id: Identifier
    chapter: Annotated[int,Field(ge=1,le=114)]
    ayah_start: Annotated[int,Field(ge=1,le=286)]
    ayah_end: Annotated[int,Field(ge=1,le=286)]
    material_kind: Literal["arabic_text","translation","tafsir","linguistic_annotation","scholarship"]
    link_kind: Literal["representation","explicit_citation","discussion","interpretive_claim"]
    citation_basis: Literal["none","resolved_reference","owner_identified"] = "none"
    citation_id: Identifier | None = None
    marker_start: Annotated[int,Field(ge=0,le=499)] | None = None
    marker_end: Annotated[int,Field(ge=1,le=500)] | None = None


class VerseMaterialUpdate(VerseMetadata):
    project_id: Identifier
    material_id: Identifier
    expected_revision: Annotated[int,Field(ge=1)]


class NotebookLink(Input):
    kind: Literal["record","annotation","entry"]
    id: Identifier
    rationale: Annotated[str,Field(min_length=1,max_length=2000)]


class NotebookMetadata(VerseOwnerInput):
    thought_type: Literal["note","question","source_claim","interpretation","objection"] = "note"
    title: Annotated[str,Field(min_length=1,max_length=300)]
    body: Annotated[str,Field(min_length=1,max_length=20000)]
    links: Annotated[list[NotebookLink],Field(max_length=25)] = Field(default_factory=list)


class NotebookCreate(NotebookMetadata):
    request_uuid: Annotated[str,Field(min_length=36,max_length=36)]
    project_id: Identifier | None = None
    record_id: Identifier | None = None
    document_id: Identifier | None = None
    annotation_id: Identifier | None = None
    reading_position: Annotated[int,Field(ge=0,le=12000,strict=True)] | None = None


class NotebookUpdate(NotebookMetadata):
    entry_id: Identifier
    project_id: Identifier | None = None
    expected_revision: Annotated[int,Field(ge=1)]
    state: Literal["active","withdrawn"] = "active"


class GutenbergBinding(Input):
    project_id: Identifier | None = None
    book_id: Annotated[int, Field(ge=1,le=999999,strict=True)]
    version: Annotated[str,Field(pattern=r'^[a-f0-9]{64}$')]
    section: Annotated[int,Field(ge=0,le=1000,strict=True)]


class GutenbergPlace(GutenbergBinding):
    position: Annotated[int,Field(ge=0,le=12000,strict=True)] = 0
    expected_revision: Annotated[int,Field(ge=0,strict=True)]


class GutenbergAnnotation(Input):
    binding: GutenbergBinding
    annotation: ReadingCaptureInput


class GutenbergNote(Input):
    binding: GutenbergBinding
    note: NotebookCreate


class LibraryIndex(VerseOwnerInput):
    request_uuid: Annotated[str,Field(min_length=36,max_length=36)]
    project_id: Identifier
    source_record_id: Identifier
    expected_source_revision: Annotated[int,Field(ge=1,strict=True)]


class LibraryItemUpdate(VerseOwnerInput):
    item_id: Identifier
    expected_revision: Annotated[int,Field(ge=1,strict=True)]
    on_shelf: Annotated[bool,Field(strict=True)]
    reading_status: Literal['needs_review','want_to_read','reading','finished']
    preferred_edition_id: Identifier | None


class LibraryMembership(VerseOwnerInput):
    item_id: Identifier
    project_id: Identifier
    state: Literal['active','removed']
    expected_revision: Annotated[int,Field(ge=0,strict=True)]


class NotebookDraftValue(Input):
    thought_type: Literal["note","question","source_claim","interpretation","objection"] = "note"
    title: Annotated[str,Field(max_length=300)] = ""
    body: Annotated[str,Field(max_length=20000)] = ""
    links: Annotated[list[NotebookLink],Field(max_length=25)] = Field(default_factory=list)
    state: Literal["active","withdrawn"] = "active"


class NotebookDraftInput(Input):
    draft_uuid: Annotated[str,Field(pattern=r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")]
    project_id: Identifier | None = None
    entry_id: Identifier | None = None
    request_uuid: Annotated[str,Field(min_length=36,max_length=36)] | None = None
    record_id: Identifier | None = None
    document_id: Identifier | None = None
    annotation_id: Identifier | None = None
    reading_position: Annotated[int,Field(ge=0,le=12000,strict=True)] | None = None
    base_revision: Annotated[int,Field(ge=0)]
    expected_revision: Annotated[int,Field(ge=0)]
    value: NotebookDraftValue
    state: Literal["active","discarded"] = "active"


class PrivateTrashInput(Input):
    project_id: Identifier | None = None
    target_kind: Literal["entry","annotation"]
    target_id: Identifier
    target_revision: Annotated[int,Field(ge=1)]
    expected_revision: Annotated[int,Field(ge=0)]
    state: Literal["trashed","active"]


class PublicationSelection(Input):
    record_id: Identifier
    include_summary: bool = False
    include_bibliography: bool = False


class LexiconOwnerInput(Input):
    owner_confirmed: bool

    @field_validator("owner_confirmed")
    @classmethod
    def explicit_lexicon_choice(cls,value):
        if value is not True: raise ValueError("Explicit owner lexical choice required")
        return value


class LexiconNewEntry(Input):
    entry_type: Literal["undetermined","word","multiword"] = "undetermined"
    scope: Annotated[str,Field(min_length=1,max_length=10000)]
    language_tag: Annotated[str,Field(min_length=1,max_length=100)] = "und"
    script_tag: Annotated[str,Field(max_length=4)] = ""
    transliteration_scheme: Annotated[str,Field(max_length=500)] = ""


class LexiconNewConcept(Input):
    mode: Literal["new"]
    title: Annotated[str,Field(min_length=1,max_length=2000)]
    scope: Annotated[str,Field(min_length=1,max_length=10000)]
    language_tag: Annotated[str,Field(min_length=1,max_length=100)] = "und"


class LexiconExistingConcept(Input):
    mode: Literal["existing"]
    concept_id: Identifier


class LexiconCaptureInput(LexiconOwnerInput):
    request_uuid: Annotated[str,Field(pattern=r"^[a-fA-F0-9-]{36}$")]
    project_id: Identifier
    annotation_id: Identifier
    start: Annotated[int,Field(ge=0,le=499)]
    end: Annotated[int,Field(ge=1,le=500)]
    entry: LexiconNewEntry | None = None
    representation_id: Identifier | None = None
    concept: Annotated[LexiconNewConcept | LexiconExistingConcept,Field(discriminator="mode")] | None = None
    sense_id: Identifier | None = None
    sense_scope: Annotated[str,Field(max_length=10000)] = ""
    rationale: Annotated[str,Field(min_length=1,max_length=2000)]


class LexiconRepresentationInput(LexiconOwnerInput):
    request_uuid: Annotated[str,Field(pattern=r"^[a-fA-F0-9-]{36}$")]
    project_id: Identifier
    form_id: Identifier
    annotation_id: Identifier
    start: Annotated[int,Field(ge=0,le=499)]
    end: Annotated[int,Field(ge=1,le=500)]
    language_tag: Annotated[str,Field(min_length=1,max_length=100)]
    script_tag: Annotated[str,Field(max_length=4)] = ""
    transliteration_scheme: Annotated[str,Field(max_length=500)] = ""
    rationale: Annotated[str,Field(min_length=1,max_length=2000)]


class LexiconDefinitionInput(LexiconOwnerInput):
    definition_uuid: Annotated[str,Field(pattern=r"^[a-fA-F0-9-]{36}$")]
    project_id: Identifier
    concept_id: Identifier
    sense_id: Identifier | None = None
    annotation_id: Identifier
    definition_kind: Literal["source_explicit","reference_gloss","owner_paraphrase","machine_proposed"]
    wording_mode: Literal["quotation","paraphrase"]
    body: Annotated[str,Field(min_length=1,max_length=5000)]
    attribution: Annotated[str,Field(min_length=1,max_length=2000)]
    attribution_person_id: Identifier | None = None
    scope: Annotated[str,Field(min_length=1,max_length=10000)]
    dating_note: Annotated[str,Field(max_length=2000)] = ""
    rationale: Annotated[str,Field(min_length=1,max_length=2000)]
    proposal_tool: Annotated[str,Field(max_length=500)] = ""
    proposal_version: Annotated[str,Field(max_length=500)] = ""
    proposal_activity: Annotated[str,Field(max_length=500)] = ""


class LexiconDefinitionUpdate(LexiconOwnerInput):
    project_id: Identifier
    definition_id: Identifier
    expected_revision: Annotated[int,Field(ge=1)]
    wording_mode: Literal["quotation","paraphrase"]
    body: Annotated[str,Field(min_length=1,max_length=5000)]
    attribution: Annotated[str,Field(min_length=1,max_length=2000)]
    scope: Annotated[str,Field(min_length=1,max_length=10000)]
    dating_note: Annotated[str,Field(max_length=2000)] = ""
    rationale: Annotated[str,Field(min_length=1,max_length=2000)]
    state: Literal["active","withdrawn"] = "active"


class LexiconConnectionUpdate(LexiconOwnerInput):
    project_id: Identifier
    entity_kind: Literal["sense","occurrence"]
    entity_id: Identifier
    expected_revision: Annotated[int,Field(ge=1)]
    rationale: Annotated[str,Field(min_length=1,max_length=2000)]
    scope: Annotated[str,Field(max_length=10000)] = ""
    state: Literal["active","withdrawn"]


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

    def library_page(rows,limit,key='id'):
        return {'items':rows[:limit],'next_cursor':rows[limit-1][key] if len(rows)>limit else None}

    @router.get('/library/shelf')
    def library_shelf(project_id: Identifier | None=None,q:Annotated[str,Query(max_length=300)]='',
        state:Literal['','needs_review','want_to_read','reading','finished']='',
        cursor:Annotated[str,Query(max_length=1200)]='',limit:Annotated[int,Query(ge=1,le=50)]=30):
        return store.library_shelf(project_id=project_id or '',q=q,state=state,cursor=cursor,limit=limit)

    @router.get('/library/continue')
    def library_continue(project_id:Identifier | None=None):
        return store.library_shelf(project_id=project_id or '',limit=5,continuing=True)

    @router.get('/library/items')
    def library_items(project_id: Identifier | None=None,retained:bool=True,
        cursor:Annotated[str,Query(max_length=500)]='',limit:Annotated[int,Query(ge=1,le=50)]=30):
        return library_page(store.library_items(project_id=project_id or '',retained=retained,cursor=cursor,limit=limit+1),limit)

    @router.get('/library/item')
    def library_item(item_id:Identifier,project_id:Identifier | None=None):
        row=store.library_item(item_id,project_id or '')
        if row is None:raise HTTPException(404,'Library item not found in this context')
        return row

    @router.get('/library/source')
    def library_source(project_id:Identifier,source_record_id:Identifier):
        row=store.library_source(project_id,source_record_id)
        if row is None:raise HTTPException(404,'Source is not indexed in the owner library')
        return row

    @router.post('/library/index-source',status_code=201)
    def library_index(value:LibraryIndex,actor:str=Depends(owner)):
        fields=value.model_dump();fields.pop('owner_confirmed')
        return store.library_index_source(actor=actor,**fields)

    @router.put('/library/item')
    def library_item_update(value:LibraryItemUpdate,actor:str=Depends(owner)):
        fields=value.model_dump();fields.pop('owner_confirmed')
        return store.library_update_item(actor=actor,**fields)

    @router.put('/library/project-membership')
    def library_membership(value:LibraryMembership,actor:str=Depends(owner)):
        fields=value.model_dump();fields.pop('owner_confirmed')
        return store.library_membership(actor=actor,**fields)

    @router.get('/library/editions')
    def library_editions(item_id:Identifier,project_id:Identifier | None=None,
        cursor:Annotated[str,Query(max_length=500)]='',limit:Annotated[int,Query(ge=1,le=50)]=30):
        return library_page(store.library_editions(item_id=item_id,project_id=project_id or '',cursor=cursor,limit=limit+1),limit)

    @router.get('/library/documents')
    def library_documents(item_id:Identifier,project_id:Identifier | None=None,edition_id:Identifier | None=None,
        cursor:Annotated[str,Query(max_length=500)]='',limit:Annotated[int,Query(ge=1,le=50)]=30):
        return library_page(store.library_documents(item_id=item_id,project_id=project_id or '',edition_id=edition_id or '',cursor=cursor,limit=limit+1),limit,'document_id')

    @router.get('/library/resolve')
    def library_resolve(item_id:Identifier,document_id:Identifier,project_id:Identifier | None=None):
        row=store.library_resolve(item_id=item_id,document_id=document_id,project_id=project_id or '')
        if row is None:raise HTTPException(404,'Reading target not found in this library context')
        return row

    @router.get('/library/notes')
    def library_notes(item_id:Identifier,project_id:Identifier | None=None,
        cursor:Annotated[str,Query(max_length=700)]='',limit:Annotated[int,Query(ge=1,le=50)]=30):
        return library_page(store.library_notes(item_id=item_id,project_id=project_id or '',cursor=cursor,limit=limit+1),limit,'note_key')

    @router.get('/catalog/gutenberg/search')
    def gutenberg_search(q: Annotated[str,Query(min_length=1,max_length=200)],page: Annotated[int,Query(ge=1,le=100)]=1):
        try:return gutenberg.search(q,page)
        except gutenberg.Unavailable:raise HTTPException(503,'Gutenberg search is unavailable. Your library and notes are unchanged.') from None

    @router.get('/catalog/gutenberg/book')
    def gutenberg_book(*, project_id: Identifier | None = None,book_id: Annotated[int,Query(ge=1,le=999999)],
        version: Annotated[str,Query(max_length=64,pattern=r'^(?:[a-f0-9]{64})?$')]=''):
        try:return store.gutenberg_book(project_id,book_id,version)
        except gutenberg.Unavailable:raise HTTPException(503,'This book is unavailable or its text format is not supported yet. Try the provider link or retry later.') from None

    @router.get('/catalog/gutenberg/section')
    def gutenberg_section(*, project_id: Identifier | None = None,book_id: Annotated[int,Query(ge=1,le=999999)],
        version: Annotated[str,Query(pattern=r'^[a-f0-9]{64}$')],section: Annotated[int,Query(ge=0,le=1000)]):
        return store.gutenberg_section(project_id,book_id,version,section)

    @router.post('/catalog/gutenberg/binding',status_code=201)
    def gutenberg_binding(value:GutenbergBinding,actor:str=Depends(owner)):
        return store.gutenberg_binding(actor=actor,**value.model_dump())

    @router.post('/catalog/gutenberg/annotations',status_code=201)
    def gutenberg_annotation(value:GutenbergAnnotation,actor:str=Depends(owner)):
        return store.gutenberg_write(binding=value.binding.model_dump(),fields=value.annotation.model_dump(),action='annotation',actor=actor)

    @router.post('/catalog/gutenberg/notes',status_code=201)
    def gutenberg_note(value:GutenbergNote,actor:str=Depends(owner)):
        return store.gutenberg_write(binding=value.binding.model_dump(),fields=value.note.model_dump(),action='notebook',actor=actor)

    @router.get('/catalog/gutenberg/place')
    def gutenberg_place(*, project_id: Identifier | None = None,book_id:Annotated[int,Query(ge=1,le=999999)]):
        row=store.gutenberg_place(project_id,book_id)
        if row is None:raise HTTPException(404,'No saved place for this book')
        return row

    @router.put('/catalog/gutenberg/place')
    def save_gutenberg_place(value:GutenbergPlace,actor:str=Depends(owner)):
        return store.save_gutenberg_place(actor=actor,**value.model_dump())

    @router.get("/me")
    def me():
        return {"mode": "owner", "can_edit": True}

    @router.get("/research/search")
    def research_search(project_id: Identifier, q: Annotated[str,Query(min_length=1,max_length=300)],
        limit: Annotated[int,Query(ge=1,le=50)] = 30):
        if not q.strip(): raise HTTPException(422,"Supply a nonblank research query")
        return store.research_search(project_id,q,limit)

    @router.get("/reading/library")
    def reading_library(*, project_id: Identifier | None = None, cursor: Annotated[str,Query(max_length=500)] = "",
        limit: Annotated[int,Query(ge=1,le=50)] = 30):
        return store.reading_library(project_id,cursor,limit)

    @router.get("/reading/draft")
    def reading_draft(*, project_id: Identifier | None = None,draft_id: Identifier):
        value=store.reading_draft(project_id,draft_id)
        if value is None: raise HTTPException(404,"Draft not found in this project")
        return value

    @router.put("/reading/draft")
    def save_reading_draft(value: ReadingDraftInput,actor: str=Depends(owner)):
        return store.save_reading_draft(actor=actor,**value.model_dump())

    @router.get("/reading/drafts")
    def reading_drafts(*, project_id: Identifier | None = None,record_id: Identifier | None = None,document_id: Identifier | None = None,
        annotation_id: Identifier | None = None,context_kind: Literal["record_note","capture","annotation"] | None = None,
        state: Literal["active","discarded"] = "active",cursor: Annotated[str,Query(max_length=500)] = "",limit: Annotated[int,Query(ge=1,le=25)] = 25):
        rows=store.reading_drafts(project_id=project_id,record_id=record_id,document_id=document_id,annotation_id=annotation_id,context_kind=context_kind,state=state,cursor=cursor,limit=limit+1)
        return {"items":rows[:limit],"next_cursor":rows[limit-1]["id"] if len(rows)>limit else None}

    @router.get("/reading/draft-history")
    def reading_draft_history(*, project_id: Identifier | None = None,draft_id: Identifier,before_revision: Annotated[int,Query(ge=1)] | None = None,
        limit: Annotated[int,Query(ge=1,le=25)] = 25):
        rows=store.reading_draft_history(project_id,draft_id,before_revision,limit+1)
        if rows is None: raise HTTPException(404,"Draft history not found in this project")
        return {"items":rows[:limit],"next_before_revision":rows[limit-1]["revision"] if len(rows)>limit else None}

    @router.get("/reading/desk")
    def reading_desk(*, project_id: Identifier | None = None):
        value=store.reading_desk(project_id)
        if value is None: raise HTTPException(404,"No active reading place saved for this project")
        return value

    @router.put("/reading/desk")
    def save_reading_desk(value: ReadingDeskInput,actor: str = Depends(owner)):
        return store.save_reading_desk(actor=actor,**value.model_dump())

    @router.get("/reading/desk-history")
    def reading_desk_history(*, project_id: Identifier | None = None,before_revision: Annotated[int,Query(ge=1)] | None = None,
        limit: Annotated[int,Query(ge=1,le=25)] = 25):
        rows=store.reading_desk_history(project_id,before_revision,limit+1)
        if rows is None: raise HTTPException(404,"No active reading place saved for this project")
        return {"items":rows[:limit],"next_before_revision":rows[limit-1]["revision"] if len(rows)>limit else None}

    @router.get("/reading/collection")
    def reading_collection():
        return collection_resource()

    @router.get("/quran/catalog")
    def quran_catalog():
        return quran_reader.catalog()

    @router.get("/quran/chapter")
    def quran_chapter(chapter: Annotated[int,Query(ge=1,le=114)], translation: Literal['itani-god'] = 'itani-god'):
        return quran_reader.chapter(chapter,translation)

    @router.get('/quran/words')
    def quran_word_glosses(chapter: Annotated[int,Query(ge=1,le=114)], ayah: Annotated[int,Query(ge=1,le=286)]):
        try:
            # Keep invalid references distinct from an unavailable external source.
            quran_reader.representation('tanzil-uthmani',chapter,ayah,ayah)
        except ValueError:
            raise HTTPException(422,'Choose an existing ayah.') from None
        try:
            return quran_words.lookup(chapter,ayah)
        except Exception:
            # Do not relay provider response bodies or internal network errors.
            raise HTTPException(503,'Word translation is unavailable. Your reading and notes are unchanged.') from None

    @router.get('/quran/progress')
    def quran_progress(*, project_id: Identifier | None = None):
        return {'project_id':project_id,'items':store.quran_progress(project_id)}

    @router.put('/quran/progress')
    def save_quran_progress(value: QuranProgress, actor: str=Depends(owner)):
        quran_reader.reference(value.chapter,value.ayah)
        return store.save_quran_progress(actor=actor,**value.model_dump(exclude={'owner_confirmed'}))

    @router.post('/quran/binding',status_code=201)
    def quran_binding(value: QuranBinding,actor: str=Depends(owner)):
        return store.quran_binding(actor=actor,**value.model_dump(exclude={'owner_confirmed'}))

    @router.get('/quran/binding')
    def quran_existing(*, project_id: Identifier | None = None,resource_key: Literal['tanzil-uthmani','itani-god'],
        chapter: Annotated[int,Query(ge=1,le=114)],ayah_start: Annotated[int,Query(ge=1,le=286)],ayah_end: Annotated[int,Query(ge=1,le=286)],note_scope: Literal['verse','surah','source'] = 'verse'):
        return store.quran_existing(project_id=project_id,resource_key=resource_key,chapter=chapter,ayah_start=ayah_start,ayah_end=ayah_end,note_scope=note_scope)

    @router.post('/quran/notes',status_code=201)
    def quran_note(value: QuranNote,actor: str=Depends(owner)):
        return store.quran_note(actor=actor,**value.model_dump(exclude={'owner_confirmed'}))

    @router.get('/quran/marks')
    def quran_marks(*, project_id: Identifier | None = None,chapter: Annotated[int,Query(ge=1,le=114)],cursor: Annotated[str,Query(max_length=500)]='',limit: Annotated[int,Query(ge=1,le=100)]=100):
        items=store.quran_marks(project_id=project_id,chapter=chapter,cursor=cursor,limit=limit+1)
        return {'items':items[:limit],'next_cursor':items[limit-1]['id'] if len(items)>limit else None}

    @router.get('/quran/notes')
    def quran_notes(*, project_id: Identifier | None = None,resource_key: Literal['tanzil-uthmani','itani-god'],chapter: Annotated[int,Query(ge=1,le=114)],note_scope: Literal['surah','source'],cursor: Annotated[str,Query(max_length=500)]='',limit: Annotated[int,Query(ge=1,le=25)]=25):
        items=store.quran_notes(project_id=project_id,resource_key=resource_key,chapter=chapter,note_scope=note_scope,cursor=cursor,limit=limit+1)
        return {'items':items[:limit],'next_cursor':items[limit-1]['id'] if len(items)>limit else None}

    @router.get('/quran/place')
    def quran_place(*, project_id: Identifier | None = None):
        return store.quran_place(project_id)

    @router.put('/quran/place')
    def quran_place_save(value: QuranPlace,actor: str=Depends(owner)):
        return store.save_quran_place(actor=actor,**value.model_dump(exclude={'owner_confirmed'}))

    @router.post("/reading/link-collection",status_code=201)
    def link_collection_reading(value: CollectionReadingLink,actor: str = Depends(owner)):
        return store.link_collection_reading(actor=actor,**value.model_dump(exclude={"owner_confirmed"}))

    @router.get("/record-context")
    def record_context(project_id: Identifier, record_id: Identifier,
        cursor: Annotated[str,Query(max_length=500)]="", limit: Annotated[int,Query(ge=1,le=25)]=25):
        value=store.record_context(project_id,record_id,cursor,limit)
        if value is None: raise HTTPException(404,"Record not found in this project")
        return value
    @router.get("/notebook/items")
    def notebook_items(*, project_id: Identifier | None = None,document_id: Identifier | None = None,location_only: bool = False,q: Annotated[str,Query(max_length=300)] = "",
        item_scope: Literal["all","writing","reading"] = "all",
        thought_type: Literal["","note","question","source_claim","interpretation","objection","passage_note","record_note"] = "",
        state: Literal["active","withdrawn"] = "active",cursor: Annotated[str,Query(max_length=1100)] = "",
        limit: Annotated[int,Query(ge=1,le=25)] = 25):
        rows=store.notebook_items(project_id=project_id,q=q,thought_type=thought_type,state=state,cursor=cursor,limit=limit+1,item_scope=item_scope,**(dict(document_id=document_id,location_only=location_only) if document_id is not None or location_only else {}))
        return {"items":rows[:limit],"next_cursor":rows[limit-1]["cursor"] if len(rows)>limit else None}

    @router.get("/notebook/network")
    def notebook_network(*, project_id: Identifier | None = None,limit: Annotated[int,Query(ge=1,le=200)]=200):
        rows=store.notebook_network(project_id,limit+1)
        return {"project_id":project_id,"items":rows[:limit],"truncated":len(rows)>limit}

    @router.get("/notebook/entry")
    def notebook_entry(*, project_id: Identifier | None = None,entry_id: Identifier):
        row=store.notebook_entry(project_id,entry_id)
        if row is None:raise HTTPException(404,"Notebook thought not found in this project")
        return row

    @router.get("/notebook/drafts")
    def notebook_drafts(*, project_id: Identifier | None = None,cursor: Annotated[str,Query(max_length=500)]="",
        limit: Annotated[int,Query(ge=1,le=25)]=25):
        rows=store.notebook_drafts(project_id,cursor,limit+1)
        return {"items":rows[:limit],"next_cursor":rows[limit-1]["id"] if len(rows)>limit else None}

    @router.get("/writing/trash")
    def private_trash(project_id: Identifier,cursor: Annotated[str,Query(max_length=1100)]="",limit: Annotated[int,Query(ge=1,le=25)]=25):
        rows=store.private_trash(project_id,cursor,limit+1)
        return {"items":rows[:limit],"next_cursor":rows[limit-1]['target_kind']+':'+rows[limit-1]['target_id'] if len(rows)>limit else None}

    @router.put("/writing/trash")
    def change_private_trash(value: PrivateTrashInput,actor: str=Depends(owner)):
        return store.change_private_trash(actor=actor,**value.model_dump())

    @router.get("/notebook/draft")
    def notebook_draft(*, project_id: Identifier | None = None,draft_id: Identifier):
        row=store.notebook_draft(project_id,draft_id)
        if row is None:raise HTTPException(404,"Writing recovery not found in this project")
        return row

    @router.put("/notebook/draft")
    def save_notebook_draft(value: NotebookDraftInput,actor: str=Depends(owner)):
        return store.save_notebook_draft(actor=actor,**value.model_dump())

    @router.post("/notebook/entries",status_code=201)
    def notebook_create(value: NotebookCreate,actor: str = Depends(owner)):
        fields=value.model_dump();fields.pop("owner_confirmed")
        return store.notebook_create(actor=actor,**fields)

    @router.put("/notebook/entry")
    def notebook_update(value: NotebookUpdate,actor: str = Depends(owner)):
        fields=value.model_dump();fields.pop("owner_confirmed")
        return store.notebook_update(actor=actor,**fields)

    @router.get("/notebook/history")
    def notebook_history(*, project_id: Identifier | None = None,entry_id: Identifier,before_revision: Annotated[int,Query(ge=1)] | None = None,
        limit: Annotated[int,Query(ge=1,le=25)] = 25):
        rows=store.notebook_history(project_id=project_id,entry_id=entry_id,before_revision=before_revision,limit=limit+1)
        if rows is None:raise HTTPException(404,"Notebook thought not found in this project")
        return {"items":rows[:limit],"next_before_revision":rows[limit-1]["revision"] if len(rows)>limit else None}

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
                "research_search": {"version":1,"scope":"owner_only","endpoint":"/v1/research/search",
                    "library":"/v1/reading/library","query_max_characters":300,"max_results":50,
                    "retrieval":"case_insensitive_literal_match","ranking":"exact_title_then_title_prefix_then_literal_match",
                    "review_effect":"none","graph_effect":"none","publication_effect":"none"},
                "notebook_network": {"scope":"owner_only","endpoint":"/v1/notebook/network","max_results":200,"authority":"current_active_private_notes","canonical_graph_effect":"none","publication_effect":"none"},
                "scripture_references": {"profile_id":QURAN_PROFILE_ID,"parser_version":QURAN_PARSER_VERSION,
                    "candidates":"/v1/reading/scripture-candidates","reverse_lookup":"/v1/reading/scripture-citations",
                    "owner_resolution":"/v1/reading/scripture-citation","max_reverse_lookup_page":25,
                    "scope":"owner_only","confirmation":"explicit_owner_decision_with_revision_and_rationale",
                    "review_effect":"none","graph_effect":"none","publication_effect":"none"},
                "lexicon": {"version":1,"scope":"owner_only","search":"/v1/lexicon/search","concept":"/v1/lexicon/concept",
                    "senses":"/v1/lexicon/senses","representations":"/v1/lexicon/representations",
                    "definitions":"/v1/lexicon/definitions","occurrences":"/v1/lexicon/occurrences",
                    "annotation_links":"/v1/lexicon/annotation-links","history":"/v1/lexicon/history",
                    "capture":"/v1/lexicon/captures","max_page":25,"max_search_results":30,
                    "review_effect":"none","graph_effect":"none","publication_effect":"none",
                    "retrieval":"versioned lexical normalization; no semantic equivalence inference"},
                "verse_materials": {"version":1,"scope":"owner_only","pilot_resource":"/v1/verses/pilot",
                    "materials":"/v1/verses/materials","material":"/v1/verses/material",
                    "annotation_links":"/v1/verses/annotation-links","history":"/v1/verses/history","max_page":25,
                    "review_effect":"none","graph_effect":"none","publication_effect":"none",
                    "citation_changes":"retain original reference and flag for review"},
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
    def reading_documents(*, project_id: Identifier | None = None, source_record_id: Identifier,
                          cursor: Annotated[str, Query(max_length=500)] = "",limit: Annotated[int, Query(ge=1,le=50)] = 25):
        rows = store.reading_documents(project_id,source_record_id,cursor,limit+1)
        return {"items":rows[:limit],"next_cursor":rows[limit-1]["id"] if len(rows)>limit else None}

    @router.post("/source-intakes",status_code=201)
    def create_source_intake(value: SourceIntakeInput, actor: str = Depends(owner)):
        return store.source_intake(actor=actor,**value.model_dump())

    @router.get("/source-intakes/candidates")
    def source_intake_candidates(project_id: Identifier,
        source_url: Annotated[str,Query(max_length=2000)]="",identifier: Annotated[str,Query(max_length=2000)]="",
        limit: Annotated[int,Query(ge=1,le=20)]=20):
        rows=store.source_candidates(project_id,source_url,identifier,limit+1)
        return {"items":rows[:limit],"truncated":len(rows)>limit,
                "scope":"exact_manual_intake_hints_only; search titles separately for older or imported sources"}

    @router.get("/source-intakes")
    def source_intake_history(project_id: Identifier,source_record_id: Identifier,
        cursor: Annotated[str,Query(max_length=36)]="",limit: Annotated[int,Query(ge=1,le=25)]=25):
        rows=store.source_intake_history(project_id,source_record_id,cursor,limit+1)
        return {"items":rows[:limit],"next_cursor":str(rows[limit-1]["request_uuid"]) if len(rows)>limit else None}

    @router.post("/reading/documents",status_code=201)
    def create_reading_document(value: ReadingDocumentInput, actor: str = Depends(owner)):
        return store.create_reading_document(actor=actor,**value.model_dump())

    @router.get("/reading/document")
    def reading_document(*, project_id: Identifier | None = None, document_id: Identifier):
        value = store.reading_document(project_id,document_id)
        if value is None:
            raise HTTPException(404,"Reading snapshot not found")
        return value

    @router.get("/reading/annotations")
    def reading_annotations(*, project_id: Identifier | None = None, document_id: Identifier,
                            cursor: Annotated[str, Query(max_length=500)] = "",limit: Annotated[int, Query(ge=1,le=100)] = 50):
        rows = store.reading_annotations(project_id,document_id,cursor,limit+1)
        return {"items":rows[:limit],"next_cursor":rows[limit-1]["id"] if len(rows)>limit else None}

    @router.post("/reading/annotations",status_code=201)
    def create_reading_annotation(value: ReadingCaptureInput, actor: str = Depends(owner)):
        return store.create_reading_annotation(actor=actor,**value.model_dump())

    @router.get("/reading/annotation")
    def reading_annotation(*, project_id: Identifier | None = None, annotation_id: Identifier):
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

    @router.get("/verses/pilot")
    def verse_pilot():
        return pilot_resource()

    @router.get("/quran/reader")
    def quran_reader_candidate_resource(chapter: Annotated[int,Query(ge=1,le=114)],
                     translation_key: Literal["english_saheeh", "english_rwwad"] = "english_saheeh"):
        return chapter_resource(chapter, translation_key)

    @router.post("/quran/reader-association",status_code=201)
    def quran_reader_association(value: QuranReaderAssociation,actor: str = Depends(owner)):
        return store.quran_reader_association(actor=actor,**value.model_dump())

    @router.post("/verses/import-pilot",status_code=201)
    def verse_import_pilot(value: VersePilotImport,actor: str = Depends(owner)):
        return store.verse_import_pilot(actor=actor,**value.model_dump(exclude={"owner_confirmed"}))

    @router.post("/verses/materials",status_code=201)
    def create_verse_material(value: VerseMaterialInput,actor: str = Depends(owner)):
        return store.verse_create(actor=actor,**value.model_dump(exclude={"owner_confirmed"}))

    @router.put("/verses/material")
    def update_verse_material(value: VerseMaterialUpdate,actor: str = Depends(owner)):
        return store.verse_update(actor=actor,**value.model_dump(exclude={"owner_confirmed"}))

    @router.get("/verses/material")
    def verse_material(project_id: Identifier,material_id: Identifier):
        value=store.verse_material(project_id,material_id)
        if value is None: raise HTTPException(404,"Material not found in this project")
        return value

    @router.get("/verses/materials")
    def verse_materials(project_id: Identifier,chapter: Annotated[int,Query(ge=1,le=114)],
        ayah_start: Annotated[int,Query(ge=1,le=286)],ayah_end: Annotated[int,Query(ge=1,le=286)],
        material_kind: Literal["arabic_text","translation","tafsir","linguistic_annotation","scholarship"] | None = None,
        link_kind: Literal["representation","explicit_citation","discussion","interpretive_claim"] | None = None,
        cursor: Annotated[str,Query(max_length=500)] = "",limit: Annotated[int,Query(ge=1,le=25)] = 25):
        rows=store.verse_materials(project_id,chapter,ayah_start,ayah_end,material_kind,link_kind,cursor,limit+1)
        return {"items":rows[:limit],"next_cursor":rows[limit-1]["id"] if len(rows)>limit else None}

    @router.get("/verses/annotation-links")
    def verse_annotation_links(project_id: Identifier,annotation_id: Identifier,
        cursor: Annotated[str,Query(max_length=500)] = "",limit: Annotated[int,Query(ge=1,le=25)] = 25):
        rows=store.verse_annotation_links(project_id,annotation_id,cursor,limit+1)
        if rows is None: raise HTTPException(404,"Source passage not found in this project")
        return {"items":rows[:limit],"next_cursor":rows[limit-1]["id"] if len(rows)>limit else None}

    @router.get("/verses/history")
    def verse_history(project_id: Identifier,material_id: Identifier,
        before_revision: Annotated[int,Query(ge=1)] | None = None,limit: Annotated[int,Query(ge=1,le=25)] = 25):
        rows=store.verse_history(project_id,material_id,before_revision,limit+1)
        if rows is None: raise HTTPException(404,"Material history not found in this project")
        return {"items":rows[:limit],"next_before_revision":rows[limit-1]["revision"] if len(rows)>limit else None}

    @router.post("/lexicon/captures",status_code=201)
    def lexicon_capture(value: LexiconCaptureInput,actor: str = Depends(owner)):
        return store.lexicon_capture(actor=actor,**value.model_dump(exclude={"owner_confirmed"}))

    @router.post("/lexicon/representations",status_code=201)
    def lexicon_create_representation(value: LexiconRepresentationInput,actor: str = Depends(owner)):
        return store.lexicon_create_representation(actor=actor,**value.model_dump(exclude={"owner_confirmed"}))

    @router.post("/lexicon/definitions",status_code=201)
    def lexicon_create_definition(value: LexiconDefinitionInput,actor: str = Depends(owner)):
        return store.lexicon_create_definition(actor=actor,**value.model_dump(exclude={"owner_confirmed"}))

    @router.put("/lexicon/definition")
    def lexicon_update_definition(value: LexiconDefinitionUpdate,actor: str = Depends(owner)):
        return store.lexicon_update_definition(actor=actor,**value.model_dump(exclude={"owner_confirmed"}))

    @router.put("/lexicon/connection")
    def lexicon_update_connection(value: LexiconConnectionUpdate,actor: str = Depends(owner)):
        return store.lexicon_update_connection(actor=actor,**value.model_dump(exclude={"owner_confirmed"}))

    @router.get("/lexicon/concept")
    def lexicon_concept(project_id: Identifier,concept_id: Identifier):
        value=store.lexicon_concept(project_id,concept_id)
        if value is None: raise HTTPException(404,"Concept not found")
        return value

    def lexicon_page(rows,limit):
        return {"items":rows[:limit],"next_cursor":rows[limit-1]["id"] if len(rows)>limit else None}

    @router.get("/lexicon/senses")
    def lexicon_senses(project_id: Identifier,concept_id: Identifier,cursor: Annotated[str,Query(max_length=500)] = "",
                       limit: Annotated[int,Query(ge=1,le=25)] = 25):
        return lexicon_page(store.lexicon_senses(project_id,concept_id,cursor,limit+1),limit)

    @router.get("/lexicon/annotation-links")
    def lexicon_annotation_links(project_id: Identifier,annotation_id: Identifier,cursor: Annotated[str,Query(max_length=500)] = "",
                                limit: Annotated[int,Query(ge=1,le=25)] = 25):
        rows=store.lexicon_annotation_links(project_id,annotation_id,cursor,limit+1)
        if rows is None: raise HTTPException(404,"Reading annotation not found")
        return lexicon_page(rows,limit)

    @router.get("/lexicon/representations")
    def lexicon_representations(project_id: Identifier,entry_id: Identifier,cursor: Annotated[str,Query(max_length=500)] = "",
                               limit: Annotated[int,Query(ge=1,le=25)] = 25):
        return lexicon_page(store.lexicon_representations(project_id,entry_id,cursor,limit+1),limit)

    @router.get("/lexicon/definitions")
    def lexicon_definitions(project_id: Identifier,concept_id: Identifier,cursor: Annotated[str,Query(max_length=500)] = "",
                            limit: Annotated[int,Query(ge=1,le=25)] = 25):
        return lexicon_page(store.lexicon_definitions(project_id,concept_id,cursor,limit+1),limit)

    @router.get("/lexicon/occurrences")
    def lexicon_occurrences(project_id: Identifier,concept_id: Identifier,cursor: Annotated[str,Query(max_length=500)] = "",
                            limit: Annotated[int,Query(ge=1,le=25)] = 25):
        return lexicon_page(store.lexicon_occurrences(project_id,concept_id,cursor,limit+1),limit)

    @router.get("/lexicon/search")
    def lexicon_search(project_id: Identifier,q: Annotated[str,Query(min_length=1,max_length=500)],
                       limit: Annotated[int,Query(ge=1,le=30)] = 30):
        rows=store.lexicon_search(project_id,q,limit+1)
        return {"items":rows[:limit],"truncated":len(rows)>limit,"retrieval":"lexical text matching, not semantic equivalence or quality ranking"}

    @router.get("/lexicon/entity")
    def lexicon_entity(project_id: Identifier,entity_id: Identifier,
                       entity_kind: Literal["entry","form","representation","sense","definition","occurrence"]):
        value=store.lexicon_entity(project_id,entity_kind,entity_id)
        if value is None: raise HTTPException(404,"Lexical entity not found")
        return value

    @router.get("/lexicon/history")
    def lexicon_history(project_id: Identifier,entity_id: Identifier,
                        entity_kind: Literal["entry","form","representation","sense","definition","occurrence"],
                        before_revision: Annotated[int,Query(ge=1,le=2147483647)] = 2147483647,
                        limit: Annotated[int,Query(ge=1,le=25)] = 25):
        rows=store.lexicon_history(project_id,entity_kind,entity_id,before_revision,limit+1)
        if rows is None: raise HTTPException(404,"Lexical entity not found")
        return {"items":rows[:limit],"next_before_revision":rows[limit-1]["revision"] if len(rows)>limit else None}

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

    from .workspace_api import register_workspace
    register_workspace(router,store,owner)
    app.include_router(router)
    return app
