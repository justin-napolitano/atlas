from concurrent.futures import ThreadPoolExecutor
import os
import unittest
import uuid


@unittest.skipUnless(os.environ.get("RESEARCH_TEST_DATABASE_URL"),"Requires real isolated PostgreSQL")
class LexiconStoreTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from islam_research import database as db,lexicon_store,passage_store
        from islam_research.sql_permissions import configure
        from psycopg import sql
        from psycopg.conninfo import make_conninfo
        cls.db,cls.store,cls.passages,cls.sql=db,lexicon_store,passage_store,sql
        cls.dsn=os.environ["RESEARCH_TEST_DATABASE_URL"]
        cls.owner,cls.publisher="lex_owner_"+uuid.uuid4().hex,"lex_reader_"+uuid.uuid4().hex
        with db.connect(cls.dsn) as connection:
            db.migrate(connection)
            for role in (cls.owner,cls.publisher): connection.execute(sql.SQL("CREATE ROLE {} LOGIN").format(sql.Identifier(role)))
            connection.commit();configure(connection,cls.owner,cls.publisher,apply=True)
        cls.owner_dsn=make_conninfo(cls.dsn,user=cls.owner);cls.publisher_dsn=make_conninfo(cls.dsn,user=cls.publisher)

    @classmethod
    def tearDownClass(cls):
        with cls.db.connect(cls.dsn) as connection:
            for role in (cls.owner,cls.publisher):
                connection.execute(cls.sql.SQL("DROP OWNED BY {}").format(cls.sql.Identifier(role)))
                connection.execute(cls.sql.SQL("DROP ROLE {}").format(cls.sql.Identifier(role)))

    def setUp(self):
        self.project,self.source="test:"+uuid.uuid4().hex,"test:"+uuid.uuid4().hex
        with self.db.connect(self.owner_dsn) as connection:
            self.db.create_project(connection,self.project,"Synthetic lexical project")
            self.db.save_record(connection,record_id=self.source,project_id=self.project,kind="source",title="Synthetic lexical source",actor="test-owner")
            text="😀 tafsīr has a source-specific use. This is a synthetic fixture, not a real definition."
            self.document=self.passages.create_document(connection,project_id=self.project,source_record_id=self.source,
                edition="Synthetic edition",locator="Synthetic section 2",representation_url="https://example.invalid/source",text=text,actor="test-owner")
            self.annotation=self.passages.create_annotation(connection,annotation_uuid=str(uuid.uuid4()),project_id=self.project,
                document_id=self.document["id"],text_sha256=self.document["text_sha256"],start=2,end=len(text),exact=text[2:],
                capture_kind="term_candidate",body="Private lexical note",actor="test-owner")

    def capture_values(self,**patch):
        return {**dict(request_uuid=str(uuid.uuid4()),project_id=self.project,annotation_id=self.annotation["id"],start=0,end=6,
            entry=dict(entry_type="undetermined",scope="Synthetic lexical entry scope",language_tag="ar-Latn",script_tag="Latn",transliteration_scheme="Undeclared convention"),
            representation_id=None,concept=dict(mode="new",title="Synthetic interpretation concept",scope="An owner scope note, not a definition.",language_tag="en"),
            sense_id=None,sense_scope="Only this source-specific use",rationale="Synthetic owner connection",actor="test-owner"),**patch}

    def definition_values(self,capture,**patch):
        return {**dict(definition_uuid=str(uuid.uuid4()),project_id=self.project,concept_id=capture["concept_id"],sense_id=capture["sense_id"],
            annotation_id=self.annotation["id"],definition_kind="owner_paraphrase",wording_mode="paraphrase",body="Synthetic scoped paraphrase.",
            attribution="Synthetic owner",attribution_person_id=None,scope="This synthetic fixture only",dating_note="Historical dating unknown",
            rationale="Synthetic located support; unreviewed",proposal_tool="",proposal_version="",proposal_activity="",actor="test-owner"),**patch}

    def test_capture_is_atomic_retryable_and_preserves_missing_definition_and_exact_identity(self):
        payload=self.capture_values()
        with self.db.connect(self.owner_dsn) as connection:
            captured=self.store.capture(connection,**payload)
            self.assertEqual(captured,self.store.capture(connection,**payload))
            concept=self.store.get_concept(connection,self.project,captured["concept_id"])
            self.assertTrue(concept["definition_gap"])
            self.assertEqual(concept["concept"]["review_state"],"pending")
            occurrences=self.store.occurrences(connection,self.project,captured["concept_id"],"",26)
            self.assertEqual(len(occurrences),1);row=occurrences[0]
            self.assertEqual(row["exact"],"tafsīr");self.assertEqual(row["term_start"],0)
            self.assertEqual(row["document_id"],self.document["id"]);self.assertEqual(row["text_sha256"],self.document["text_sha256"])
            self.assertEqual(row["edition"],"Synthetic edition");self.assertEqual(row["locator"],"Synthetic section 2")
            self.assertEqual(connection.execute("SELECT count(*) AS n FROM research.lexicon_revisions WHERE entity_id=%s",(row["id"],)).fetchone()["n"],1)
            with self.assertRaises(ValueError): self.store.capture(connection,**{**payload,"rationale":"Changed request"})

    def test_concurrent_identical_requests_create_one_atomic_bundle(self):
        payload=self.capture_values()
        def run():
            with self.db.connect(self.owner_dsn) as connection: return self.store.capture(connection,**payload)
        with ThreadPoolExecutor(max_workers=2) as pool: results=list(pool.map(lambda _:run(),range(2)))
        self.assertEqual(results[0],results[1])
        with self.db.connect(self.owner_dsn) as connection:
            self.assertEqual(len(self.store.occurrences(connection,self.project,results[0]["concept_id"],"",26)),1)

    def test_failure_after_entry_creation_rolls_back_the_entire_bundle(self):
        with self.db.connect(self.owner_dsn) as connection:
            with self.assertRaises(ValueError):
                self.store.capture(connection,**self.capture_values(concept=dict(mode="existing",concept_id=self.source)))
            for table in ["lexicon_entries","lexicon_forms","lexicon_representations","lexicon_senses","lexicon_occurrences","lexicon_captures"]:
                row=connection.execute(self.sql.SQL("SELECT count(*) AS n FROM research.{} WHERE project_id=%s").format(self.sql.Identifier(table)),(self.project,)).fetchone()
                self.assertEqual(row["n"],0,table)

    def test_capture_rejects_snapshot_isolation_before_any_authoring(self):
        from psycopg import IsolationLevel
        with self.db.connect(self.owner_dsn) as connection:
            connection.isolation_level=IsolationLevel.REPEATABLE_READ
            with self.assertRaisesRegex(ValueError,"READ COMMITTED"):
                self.store.capture(connection,**self.capture_values())
        with self.db.connect(self.owner_dsn) as connection:
            self.assertEqual(connection.execute("SELECT count(*) AS n FROM research.lexicon_entries WHERE project_id=%s",(self.project,)).fetchone()["n"],0)

    def test_spelling_variants_require_explicit_grouping_and_retain_each_source_origin(self):
        with self.db.connect(self.owner_dsn) as connection:
            first=self.store.capture(connection,**self.capture_values())
            text="A synthetic alternate spelling: tafsir."
            document=self.passages.create_document(connection,project_id=self.project,source_record_id=self.source,
                edition="Another synthetic representation",locator="Synthetic section 3",representation_url="",text=text,actor="test-owner")
            annotation=self.passages.create_annotation(connection,annotation_uuid=str(uuid.uuid4()),project_id=self.project,
                document_id=document["id"],text_sha256=document["text_sha256"],start=0,end=len(text),exact=text,capture_kind="term_candidate",body="",actor="test-owner")
            start=text.index("tafsir")
            values=dict(request_uuid=str(uuid.uuid4()),project_id=self.project,form_id=first["form_id"],annotation_id=annotation["id"],
                start=start,end=start+6,language_tag="ar-Latn",script_tag="Latn",transliteration_scheme="Undeclared convention",
                rationale="Explicit owner grouping of orthographic variants; interpretation unreviewed",actor="test-owner")
            representation=self.store.create_representation(connection,**values)
            self.assertEqual(representation,self.store.create_representation(connection,**values))
            second=self.store.capture(connection,**self.capture_values(annotation_id=annotation["id"],start=start,end=start+6,
                entry=None,concept=None,sense_scope="",sense_id=first["sense_id"],representation_id=representation["id"]))
            self.assertEqual(second["concept_id"],first["concept_id"])
            reps=self.store.representations(connection,self.project,first["entry_id"],"",26)
            self.assertEqual({row["written_rep"] for row in reps},{"tafsīr","tafsir"})
            self.assertEqual(len(self.store.occurrences(connection,self.project,first["concept_id"],"",26)),2)

    def test_linking_an_imported_concept_preserves_its_id_scope_and_read_only_authority(self):
        concept_id="test:"+uuid.uuid4().hex
        with self.db.connect(self.dsn) as connection:
            connection.execute("""INSERT INTO research.records(id,project_id,kind,title,summary,origin,changed_by)
                VALUES(%s,%s,'concept','Synthetic canonical concept','Unchanged synthetic scope','canonical_rdf','synthetic-import')""",(concept_id,self.project))
        with self.db.connect(self.owner_dsn) as connection:
            captured=self.store.capture(connection,**self.capture_values(concept=dict(mode="existing",concept_id=concept_id)))
            self.assertEqual(captured["concept_id"],concept_id)
            record=self.store.get_concept(connection,self.project,concept_id)["concept"]
            self.assertEqual(record["summary"],"Unchanged synthetic scope")
            self.assertEqual(record["revision"],1)
            with self.assertRaises(self.db.RevisionConflict):
                self.db.save_record(connection,record_id=concept_id,project_id=self.project,kind="concept",title="Forbidden rewrite",actor="test-owner",expected_revision=1)

    def test_reusing_concept_and_sense_is_explicit_and_cross_project_links_fail(self):
        with self.db.connect(self.owner_dsn) as connection:
            captured=self.store.capture(connection,**self.capture_values())
            another=self.capture_values(start=0,end=6,entry=None,concept=None,representation_id=captured["representation_id"],sense_id=captured["sense_id"],sense_scope="")
            # Same occurrence, different request: no silent duplicate creates.
            from psycopg.errors import UniqueViolation
            with self.assertRaises(UniqueViolation): self.store.capture(connection,**another)
            for patch in [{"project_id":"other"},{"concept":{"mode":"existing","concept_id":self.source}},
                          {"start":1,"end":6,"entry":None,"representation_id":captured["representation_id"]}]:
                with self.assertRaises(ValueError): self.store.capture(connection,**self.capture_values(**patch))
            self.assertIsNone(self.store.get_concept(connection,"other",captured["concept_id"]))
            self.assertEqual(self.store.search(connection,"other","tafsir",31),[])

    def test_normalized_lookup_does_not_merge_meanings_or_promote_review(self):
        with self.db.connect(self.owner_dsn) as connection:
            first=self.store.capture(connection,**self.capture_values())
            second=self.store.capture(connection,**self.capture_values(concept=dict(mode="new",title="Another scoped meaning",scope="A different concept, not assumed equivalent",language_tag="en")))
            self.assertNotEqual(first["concept_id"],second["concept_id"])
            found=self.store.search(connection,self.project,"tafsir",31)
            self.assertEqual({row["id"] for row in found},{first["concept_id"],second["concept_id"]})
            self.assertTrue(all(row["original"]=="tafsīr" for row in found))
            self.assertTrue(all(row["review_state"]=="pending" for row in found))

    def test_definitions_are_located_attributed_independent_and_revisioned(self):
        with self.db.connect(self.owner_dsn) as connection:
            captured=self.store.capture(connection,**self.capture_values())
            payload=self.definition_values(captured)
            definition=self.store.create_definition(connection,**payload)
            self.assertEqual(definition,self.store.create_definition(connection,**payload))
            second=self.store.create_definition(connection,**self.definition_values(captured,definition_kind="reference_gloss",body="A different synthetic gloss.",attribution="Synthetic reference author"))
            self.assertNotEqual(definition["id"],second["id"])
            self.assertFalse(self.store.get_concept(connection,self.project,captured["concept_id"])["definition_gap"])
            definitions=self.store.definitions(connection,self.project,captured["concept_id"],"",26)
            self.assertEqual(len(definitions),2);self.assertTrue(all(row["review_state"]=="pending" for row in definitions))
            self.assertEqual(definitions[0]["source_record_id"],self.source)
            changed=dict(project_id=self.project,definition_id=definition["id"],expected_revision=1,wording_mode="paraphrase",body="Corrected synthetic paraphrase.",
                attribution="Synthetic owner",scope="Narrower fixture scope",dating_note="Still unknown",rationale="Explicit correction",state="active",actor="test-owner")
            row=self.store.update_definition(connection,**changed);self.assertEqual(row["revision"],2)
            self.assertEqual(row,self.store.update_definition(connection,**changed))
            with self.assertRaises(self.db.RevisionConflict): self.store.update_definition(connection,**{**changed,"body":"Stale conflicting text"})

    def test_false_quotation_unlocated_proposal_and_bad_attribution_do_not_save(self):
        with self.db.connect(self.owner_dsn) as connection:
            captured=self.store.capture(connection,**self.capture_values())
            for patch in [{"wording_mode":"quotation"},{"annotation_id":"missing"},{"attribution":" "},{"definition_kind":"machine_proposed"}]:
                with self.assertRaises(ValueError): self.store.create_definition(connection,**self.definition_values(captured,**patch))
            self.assertEqual(self.store.definitions(connection,self.project,captured["concept_id"],"",26),[])
            quote=self.store.create_definition(connection,**self.definition_values(captured,wording_mode="quotation",body=self.annotation["exact"],definition_kind="source_explicit"))
            self.assertEqual(quote["body"],self.annotation["exact"])
            self.assertEqual(quote["review_state"],"pending")

    def test_machine_proposal_keeps_definition_gap_and_attributable_tool_metadata(self):
        with self.db.connect(self.owner_dsn) as connection:
            captured=self.store.capture(connection,**self.capture_values())
            proposed=self.store.create_definition(connection,**self.definition_values(captured,definition_kind="machine_proposed",
                proposal_tool="synthetic-tool",proposal_version="1",proposal_activity="synthetic:activity"))
            self.assertEqual(proposed["review_state"],"pending")
            self.assertTrue(self.store.get_concept(connection,self.project,captured["concept_id"])["definition_gap"])

    def test_withdrawal_keeps_history_and_project_scoped_entity_retrieval(self):
        with self.db.connect(self.owner_dsn) as connection:
            captured=self.store.capture(connection,**self.capture_values())
            values=dict(project_id=self.project,entity_kind="sense",entity_id=captured["sense_id"],expected_revision=1,
                rationale="Withdraw this synthetic interpretation",state="withdrawn",scope="Only the original fixture",actor="test-owner")
            row=self.store.update_connection(connection,**values)
            self.assertEqual(row["revision"],2)
            self.assertEqual(self.store.occurrences(connection,self.project,captured["concept_id"],"",26),[])
            self.store.update_connection(connection,**{**values,"entity_kind":"occurrence","entity_id":captured["occurrence_id"],"scope":""})
            self.assertEqual(self.store.get_entity(connection,self.project,"sense",captured["sense_id"])["state"],"withdrawn")
            history=self.store.history(connection,self.project,"sense",captured["sense_id"],2147483647,26)
            self.assertEqual([row["revision"] for row in history],[2,1])
            self.assertIsNone(self.store.history(connection,"other","sense",captured["sense_id"],2147483647,26))

    def test_restricted_roles_cannot_rewrite_targets_promote_review_or_read_private_lexicon(self):
        from psycopg.errors import InsufficientPrivilege,CheckViolation
        with self.db.connect(self.owner_dsn) as connection:
            captured=self.store.capture(connection,**self.capture_values())
            for query in ["UPDATE research.lexicon_occurrences SET exact='fake' WHERE id=%s",
                          "UPDATE research.lexicon_senses SET review_state='reviewed' WHERE id=%s",
                          "DELETE FROM research.lexicon_revisions WHERE entity_id=%s"]:
                with self.assertRaises(InsufficientPrivilege):
                    with connection.transaction(): connection.execute(query,(captured["occurrence_id"],))
        with self.db.connect(self.dsn) as connection:
            with self.assertRaises(CheckViolation):
                with connection.transaction(): connection.execute("UPDATE research.lexicon_occurrences SET term_start=1,revision=revision+1 WHERE id=%s",(captured["occurrence_id"],))
        with self.db.connect(self.publisher_dsn) as connection:
            for table in ["lexicon_entries","lexicon_representations","lexicon_senses","lexicon_occurrences","lexicon_definitions","lexicon_revisions","lexicon_captures"]:
                with self.assertRaises(InsufficientPrivilege):
                    with connection.transaction(): connection.execute("SELECT * FROM research."+table)

    def test_record_publication_does_not_include_private_lexical_assertions_or_counts(self):
        from islam_research import publication
        import json
        with self.db.connect(self.owner_dsn) as connection:
            captured=self.store.capture(connection,**self.capture_values())
            definition=self.store.create_definition(connection,**self.definition_values(captured))
            preview=publication.preview(connection,project_id=self.project,selections=[{"record_id":captured["concept_id"],"include_summary":True}],relation_ids=[],actor="test-owner")
            public=json.dumps(preview["payload"],default=str)
            for private in [definition["body"],self.annotation["exact"],captured["occurrence_id"],captured["sense_id"],"lexicon_occurrences"]: self.assertNotIn(private,public)
