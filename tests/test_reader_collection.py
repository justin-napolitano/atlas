from copy import deepcopy
import hashlib
import unittest
import os
import uuid

from islam_research.reader_collection import collection_resource,validate_collection


class ReaderCollectionTests(unittest.TestCase):
    def test_actual_bounded_collection_has_both_named_translations_and_located_comparison(self):
        value=collection_resource();sources={s["id"]:s for s in value["sources"]}
        translations=[r for r in value["readings"] if r["material_kind"]=="translation"]
        self.assertEqual({r["reference"]["label"] for r in translations},{"Q 4:59","Q 4:83"})
        self.assertTrue(all("Rodwell" in sources[r["source_id"]]["creators"] for r in translations))
        self.assertTrue(all(sources[r["source_id"]]["rights"]["status"]=="public_domain_us" for r in translations))
        self.assertEqual({r["source_id"] for r in value["readings"] if r["material_kind"]=="tafsir"},{"tabari-4-59","tabatabai-rizvi-4-59"})
        self.assertTrue(any(c["kind"]=="term" and "istinbāṭ" in c["label"] for c in value["context_cards"]))
        self.assertIn("Rizvi",sources["tabatabai-rizvi-4-59"]["creators"])
        self.assertIsNone(sources["tabatabai-rizvi-4-59"]["evidence"]["sha256"])
        self.assertTrue(any("Sirry" in gap for gap in value["coverage_gaps"]))
        value["readings"][0]["text"]="changed"
        self.assertNotEqual(collection_resource()["readings"][0]["text"],"changed")

    def test_validation_refuses_changed_quotes_false_review_and_unlocated_context(self):
        original=collection_resource()
        patches=[lambda c:c["readings"][0].update(text="changed"),lambda c:c["readings"][0].update(review_state="human_reviewed"),
                 lambda c:c["readings"][0].update(source_id="missing"),lambda c:c["readings"][0]["reference"].update(ayah_start=300),
                 lambda c:c["readings"][0]["finding"].update(wording_mode="quotation"),lambda c:c["context_cards"][0].update(reading_ids=["missing"]),
                 lambda c:c["sources"][0]["rights"].update(status="open_license"),lambda c:c["sources"][0].update(source_url="https://example.invalid/unreviewed"),
                 lambda c:c["sources"][-1]["evidence"].update(sha256="a"*64)]
        for patch in patches:
            value=deepcopy(original);patch(value)
            with self.subTest(patch=patch),self.assertRaises(ValueError):validate_collection(value)
        value=deepcopy(original);row=value["readings"][2];row["text"]="word "*26;row["text_sha256"]=hashlib.sha256(row["text"].encode()).hexdigest()
        with self.assertRaises(ValueError):validate_collection(value)


@unittest.skipUnless(os.environ.get('RESEARCH_TEST_DATABASE_URL'),'Requires real isolated PostgreSQL')
class CollectionIntakeTests(unittest.TestCase):
    def test_actual_readings_import_exactly_without_promoting_editorial_state(self):
        from islam_research import database as db,source_intake,passage_store
        collection=collection_resource();sources={row['id']:row for row in collection['sources']}
        project='test:'+uuid.uuid4().hex;identities={}
        with db.connect(os.environ['RESEARCH_TEST_DATABASE_URL']) as connection:
            db.migrate(connection);db.create_project(connection,project,'Actual bounded reading import test')
            for reading in collection['readings']:
                source=sources[reading['source_id']]
                values={key:'' for key in source_intake.LIMITS}
                values.update(intake_uuid=str(uuid.uuid4()),project_id=project,actor='test-owner',title=source['title'],creators=source['creators'],
                    edition=source['edition'],source_url=source['source_url'],language=source['language'],accessed_on=source['accessed_on'],
                    source_role='translation' if reading['material_kind']=='translation' else 'commentary',access_status='open',
                    rights_status='public_domain' if source['rights']['status']=='public_domain_us' else 'permitted_excerpt',rights_basis=source['rights']['basis'],
                    coverage_scope='selected_passage',intake_context=source['rights']['notice'],rationale=reading['source_scope'],owner_confirmed=True,
                    existing_source_record_id=identities.get(source['id']),excerpt=dict(text=reading['text'],edition=source['edition'],locator=reading['locator'],representation_url=source['source_url']))
                result=source_intake.create(connection,**values);identities[source['id']]=result['record_id']
                document=passage_store.get_document(connection,project,result['document_id'])
                self.assertEqual(document['text_body'],reading['text']);self.assertEqual(document['text_sha256'],reading['text_sha256'])
                self.assertEqual(db.get_record(connection,result['record_id'])['review_state'],'pending')
                self.assertEqual(source_intake.create(connection,**values)['document_id'],result['document_id'])
            self.assertEqual(len(identities),4)
