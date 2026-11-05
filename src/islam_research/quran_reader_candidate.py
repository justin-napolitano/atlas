"""Bounded continuous Qur'an reading resources and private verse association.

Arabic bytes are an exact, pinned Tanzil extraction. English is read live from
QuranEnc so the provider's current version and corrections remain visible. No
provider response promotes a passage to scholarly review or publication.
"""
from __future__ import annotations

import hashlib
from importlib.resources import files
import json
from urllib.request import Request, urlopen
import uuid

from . import database as db, passage_store
from .quran_citations import reference

ARABIC_ARTIFACT_SHA256 = "4159345203c8dfe0905c4f4c0ed1f20dbdf6830e99daaa2d579d47f760dcff5a"
TRANSLATIONS = {"english_saheeh", "english_rwwad"}
PROVIDER = "https://quranenc.com"


def arabic_resource():
    raw = files("islam_research").joinpath("resources/quran-reader-arabic-v1.json").read_bytes()
    if hashlib.sha256(raw).hexdigest() != ARABIC_ARTIFACT_SHA256:
        raise ValueError("The Arabic reading resource changed; check its official source before use")
    return json.loads(raw)


def _get_json(path):
    req = Request(PROVIDER + path, headers={"Accept": "application/json", "User-Agent": "islam-research/0.1 (bounded-owner-reader)"})
    with urlopen(req, timeout=12) as response:
        if response.status != 200:
            raise ValueError("The translation provider is unavailable")
        raw = response.read(1_000_001)
    if len(raw) > 1_000_000:
        raise ValueError("The translation response exceeds the bounded reader limit")
    return json.loads(raw)


def translation_resource(chapter, key, get_json=_get_json):
    if key not in TRANSLATIONS:
        raise ValueError("This translation resource is not enabled")
    catalog = get_json("/api/v1/translations/list/en")
    meta = next((row for row in catalog.get("translations", []) if row.get("key") == key), None)
    if not meta or not all(isinstance(meta.get(field), str) and meta[field] for field in ("title", "version", "description")):
        raise ValueError("The translation identity or version is unavailable")
    result = get_json(f"/api/v1/translation/sura/{key}/{chapter}")
    rows = result.get("result", [])
    expected = arabic_resource()["coverage"].get(str(chapter))
    if not isinstance(rows, list) or len(rows) != expected:
        raise ValueError("The translation does not cover this complete supported surah")
    verses = []
    for index, row in enumerate(rows, 1):
        if str(row.get("sura")) != str(chapter) or str(row.get("aya")) != str(index):
            raise ValueError("The translation verse order or reference changed")
        body, footnotes = row.get("translation"), row.get("footnotes", "")
        if not isinstance(body, str) or not body or not isinstance(footnotes, str):
            raise ValueError("The translation text or footnotes are incomplete")
        verses.append({"ayah": index, "text": body, "footnotes": footnotes,
                       "text_sha256": hashlib.sha256(body.encode("utf-8")).hexdigest()})
    return {"resource_id": f"urn:research:quran-translation:quranenc:{key}:{meta['version']}",
            "key": key, "label": meta["title"], "publisher": meta["description"],
            "version": meta["version"], "last_update": meta.get("last_update"),
            "provider": "QuranEnc.com", "provider_url": PROVIDER,
            "terms_url": "https://quranenc.com/en/home/api/",
            "source_url": f"{PROVIDER}/api/v1/translation/sura/{key}/{chapter}",
            "verses": verses, "review_limit": "Provider translation display only; not a scholarly interpretation review."}


def chapter_resource(chapter, translation_key="english_saheeh", get_json=_get_json):
    resource = arabic_resource()
    if str(chapter) not in resource["chapters"]:
        raise ValueError("Only complete Surahs 1 and 4 are supported in this reading pilot")
    arabic = {key: resource[key] for key in ("resource_id", "label", "publisher", "declared_version", "source_url",
                                            "source_sha256", "license_url", "attribution_url", "source_notice", "review_limit")}
    arabic["verses"] = resource["chapters"][str(chapter)]
    translation, availability = None, "available"
    try:
        translation = translation_resource(chapter, translation_key, get_json)
    except (OSError, TimeoutError, ValueError, json.JSONDecodeError):
        availability = "unavailable_or_incomplete"
    return {"chapter": chapter, "ayah_count": resource["coverage"][str(chapter)],
            "arabic": arabic, "translation": translation, "translation_availability": availability,
            "requested_translation": translation_key,
            "review_limit": "Continuous reading coverage is not scholarly commentary or full-corpus review."}


def associate_verse(connection, *, project_id, chapter, ayah, resource_id, text_sha256, actor,
                    translation_key="english_saheeh", get_json=_get_json):
    """Idempotently make an exact verse representation available to private notes.

    A content change between reading and saving is refused, so a translation
    switch or provider correction cannot silently move a note's anchor.
    """
    db._text(project_id, "project ID", 500)
    db._text(actor, "actor", 500)
    if not isinstance(text_sha256, str) or len(text_sha256) != 64:
        raise ValueError("Supply the exact displayed text digest")
    shown = chapter_resource(chapter, translation_key, get_json)
    if not 1 <= ayah <= shown["ayah_count"]:
        raise ValueError("Ayah is outside the supported surah")
    choice = next((item for item in (shown["arabic"], shown["translation"]) if item and item["resource_id"] == resource_id), None)
    if choice is None:
        raise ValueError("The selected resource is unavailable or changed; reload it before saving")
    verse = choice["verses"][ayah - 1]
    if verse["text_sha256"] != text_sha256:
        raise ValueError("The displayed wording changed; reopen this resource before saving")
    is_arabic = choice is shown["arabic"]
    source_id = "urn:research:source:" + str(uuid.uuid5(uuid.NAMESPACE_URL, project_id + "\n" + resource_id))
    label = choice["label"]
    notice = ("Source: Tanzil Project — https://tanzil.net/\n" + choice["source_notice"]
              if is_arabic else f"{label}; version {choice['version']}; {choice['publisher']}; provided by QuranEnc.com. "
                                f"Resource {resource_id}. Terms: {choice['terms_url']}. "
                                "Personal notes are private and do not alter the translation.")
    attrs = {"resource_id": resource_id, "source_url": choice["source_url"],
             "version": choice.get("declared_version", choice.get("version")),
             "source_role": "primary_text" if is_arabic else "translation",
             "review_limit": choice["review_limit"], "publication_effect": "none"}
    with connection.transaction():
        connection.execute("""INSERT INTO research.records(id,project_id,kind,title,attributes,changed_by)
            VALUES(%s,%s,'source',%s,%s,%s) ON CONFLICT(id) DO NOTHING""",
            (source_id, project_id, label, db.Jsonb(attrs), actor))
        source = connection.execute("SELECT * FROM research.records WHERE id=%s AND project_id=%s AND deleted_at IS NULL",
                                    (source_id, project_id)).fetchone()
        if not source or source["kind"] != "source" or source["attributes"].get("resource_id") != resource_id:
            raise ValueError("This reading resource needs identity reconciliation")
        document = passage_store.create_document(connection, project_id=project_id, source_record_id=source_id,
            edition=label if is_arabic else label + " · " + attrs["version"], locator=reference(chapter, ayah)["label"],
            representation_url=choice["source_url"], text=verse["text"], actor=actor, source_notice=notice)
    return {"project_id": project_id, "record_id": source_id, "document_id": document["id"],
            "chapter": chapter, "ayah": ayah, "resource_id": resource_id, "text_sha256": text_sha256,
            "review_effect": "none", "publication_effect": "none"}
