import hashlib
import os
import unittest
from unittest.mock import patch
import uuid

from islam_research.quran_reader import arabic_resource, chapter_resource, translation_resource
from islam_research.quran_resources import pilot_resource


class QuranReaderResources(unittest.TestCase):
    def test_complete_pinned_surahs_and_existing_pilot_identity(self):
        value = arabic_resource()
        self.assertIn("PLEASE DO NOT REMOVE OR CHANGE THIS COPYRIGHT BLOCK", value["source_notice"])
        self.assertIn("Copyright (C) 2007-2026 Tanzil Project", value["source_notice"])
        for chapter, count in [(1, 7), (4, 176)]:
            rows = value["chapters"][str(chapter)]
            self.assertEqual([row["ayah"] for row in rows], list(range(1, count + 1)))
            for row in rows:
                self.assertEqual(hashlib.sha256(row["text"].encode()).hexdigest(), row["text_sha256"])
        for pilot in pilot_resource()["verses"]:
            self.assertEqual(value["chapters"]["4"][pilot["ayah_start"] - 1]["text"], pilot["text"])
        with patch("islam_research.quran_reader.ARABIC_ARTIFACT_SHA256", "0" * 64):
            with self.assertRaisesRegex(ValueError, "changed"):
                arabic_resource()

    def fixture(self):
        catalog = {"translations": [{"key": "english_saheeh", "title": "English Translation - Noor International Center",
                                     "description": "Issued by Noor International Center.", "version": "1.1.2"}]}
        surah = {"result": [{"sura": "1", "aya": str(n), "translation": f"Verse {n}", "footnotes": ""}
                            for n in range(1, 8)]}
        return catalog, surah

    def test_translation_version_and_complete_order_are_required(self):
        catalog, surah = self.fixture()
        def get(path):
            return catalog if "list/en" in path else surah
        value = translation_resource(1, "english_saheeh", get)
        self.assertIn("Noor International Center", value["label"])
        self.assertTrue(value["resource_id"].endswith(":1.1.2"))
        self.assertEqual(len(value["verses"]), 7)
        for bad in [surah["result"][:-1], [*surah["result"][:3], surah["result"][2], *surah["result"][4:]]]:
            with self.assertRaisesRegex(ValueError, "complete|order"):
                translation_resource(1, "english_saheeh", lambda path: catalog if "list/en" in path else {"result": bad})
        with self.assertRaisesRegex(ValueError, "not enabled"):
            translation_resource(1, "unlisted", get)

    def test_unavailable_translation_keeps_arabic_with_explicit_gap(self):
        def offline(_):
            raise OSError("provider offline")
        value = chapter_resource(4, get_json=offline)
        self.assertEqual(value["ayah_count"], 176)
        self.assertIsNone(value["translation"])
        self.assertEqual(value["translation_availability"], "unavailable_or_incomplete")
        with self.assertRaisesRegex(ValueError, "Only complete"):
            chapter_resource(2, get_json=offline)


@unittest.skipUnless(os.environ.get("RESEARCH_TEST_DATABASE_URL"), "Requires isolated PostgreSQL")
class QuranReaderAssociation(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from islam_research import database as db
        from islam_research.sql_permissions import configure
        from psycopg import sql
        from psycopg.conninfo import make_conninfo, conninfo_to_dict
        cls.db, cls.sql = db, sql
        cls.dsn = os.environ["RESEARCH_TEST_DATABASE_URL"]
        cls.owner, cls.publisher = "qreader_owner_" + uuid.uuid4().hex, "qreader_publisher_" + uuid.uuid4().hex
        with db.connect(cls.dsn) as connection:
            db.migrate(connection)
            for role in (cls.owner, cls.publisher):
                connection.execute(sql.SQL("CREATE ROLE {} LOGIN").format(sql.Identifier(role)))
                password = conninfo_to_dict(cls.dsn).get("password")
                if password:
                    connection.execute(sql.SQL("ALTER ROLE {} PASSWORD {}").format(sql.Identifier(role), sql.Literal(password)))
            connection.commit()
            configure(connection, cls.owner, cls.publisher, apply=True)
        cls.owner_dsn = make_conninfo(cls.dsn, user=cls.owner)

    @classmethod
    def tearDownClass(cls):
        with cls.db.connect(cls.dsn) as connection:
            for role in (cls.owner, cls.publisher):
                connection.execute(cls.sql.SQL("DROP OWNED BY {}").format(cls.sql.Identifier(role)))
                connection.execute(cls.sql.SQL("DROP ROLE {}").format(cls.sql.Identifier(role)))

    def test_exact_association_retries_without_duplicate_source_or_document(self):
        from islam_research import passage_store
        from islam_research.quran_reader import associate_verse
        project = "test:qreader:" + uuid.uuid4().hex
        verse = arabic_resource()["chapters"]["4"][58]
        with self.db.connect(self.owner_dsn) as connection:
            self.db.create_project(connection, project, "Synthetic Qur'an reading")
            payload = dict(project_id=project, chapter=4, ayah=59,
                           resource_id=arabic_resource()["resource_id"], text_sha256=verse["text_sha256"], actor="owner")
            first = associate_verse(connection, **payload)
            self.assertEqual(first, associate_verse(connection, **payload))
            document = passage_store.get_document(connection, project, first["document_id"])
            self.assertEqual(document["text_body"], verse["text"])
            self.assertIn("Tanzil Project", document["source_notice"])
            with self.assertRaisesRegex(ValueError, "wording changed"):
                associate_verse(connection, **{**payload, "text_sha256": "0" * 64})
            with self.assertRaisesRegex(ValueError, "outside the supported"):
                associate_verse(connection, **{**payload, "ayah": 177})
            self.assertIsNone(passage_store.get_document(connection, "another-project", first["document_id"]))

    def test_translation_version_changes_refuse_stale_display_and_keep_prior_snapshot(self):
        from islam_research import passage_store
        from islam_research.quran_reader import associate_verse
        project = "test:qreader:" + uuid.uuid4().hex
        catalog = {"translations": [{"key":"english_saheeh","title":"Named test translation",
                                     "description":"Test publisher","version":"1.0"}]}
        response = {"result":[{"sura":"1","aya":str(n),"translation":f"Test verse {n}","footnotes":""} for n in range(1,8)]}
        get = lambda path: catalog if "list/en" in path else response
        resource = translation_resource(1, "english_saheeh", get)
        with self.db.connect(self.owner_dsn) as connection:
            self.db.create_project(connection, project, "Synthetic translation reading")
            payload = dict(project_id=project, chapter=1, ayah=1, resource_id=resource["resource_id"],
                           text_sha256=resource["verses"][0]["text_sha256"], actor="owner", get_json=get)
            first = associate_verse(connection, **payload)
            self.assertEqual(first, associate_verse(connection, **payload))
            response["result"][0]["translation"] = "Revised test verse"
            with self.assertRaisesRegex(ValueError, "wording changed"):
                associate_verse(connection, **payload)
            old = passage_store.get_document(connection, project, first["document_id"])
            self.assertEqual(old["text_body"], "Test verse 1")
