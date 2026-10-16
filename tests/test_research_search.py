import os
import unittest
import uuid

from islam_research.research_search import _result, validate_query


class ResearchSearchValidationTests(unittest.TestCase):
    def test_query_bounds_do_not_turn_literals_into_operators(self):
        self.assertEqual(validate_query('synthetic:project',"  %_' OR true --  ",50),"%_' OR true --")
        for query,limit in [(' ',30),('x'*301,30),('ok',0),('ok',51),('ok',True)]:
            with self.subTest(query=query,limit=limit),self.assertRaises(ValueError):
                validate_query('synthetic:project',query,limit)

    def test_excerpts_are_bounded_plain_exact_text_with_explicit_match_basis(self):
        text='a'*500+'<script>needle</script>'+'ب'*500
        result=_result(dict(id='synthetic:doc',search_text=text,tier=2,channel='document_text'),'needle')
        self.assertLessEqual(len(result['excerpt']),360)
        self.assertIn('<script>needle</script>',result['excerpt'])
        self.assertEqual(text[result['excerpt_start']:result['excerpt_start']+len(result['excerpt'])],result['excerpt'])
        self.assertTrue(result['excerpt_truncated'])
        self.assertIn('immutable saved document text',result['match_basis'])
        self.assertNotIn('search_text',result)
        long_query='b'*300
        long_result=_result(dict(id='synthetic:doc',search_text='a'*500+long_query+'c'*500,tier=2,channel='document_text'),long_query)
        self.assertIn(long_query,long_result['excerpt'])

    def test_lowercase_expansion_does_not_shift_original_excerpt_coordinates(self):
        for prefix in ['İ'*500,'😀 İΣ العربية '*80]:
            with self.subTest(prefix=prefix[:15]):
                text=prefix+'needle'+' tail'*100
                result=_result(dict(id='synthetic:unicode',search_text=text,tier=2,channel='document_text'),'needle')
                self.assertIn('needle',result['excerpt'])
                start=result['excerpt_start']
                self.assertGreaterEqual(start,0)
                self.assertLess(start,len(text))
                self.assertEqual(text[start:start+len(result['excerpt'])],result['excerpt'])
                self.assertLessEqual(len(result['excerpt']),360)


@unittest.skipUnless(os.environ.get('RESEARCH_TEST_DATABASE_URL'),'Requires real isolated PostgreSQL')
class ResearchSearchStoreTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from islam_research import database as db,passage_store,notebook,lexicon_store,research_search
        from islam_research.sql_permissions import configure
        from psycopg import sql
        from psycopg.conninfo import make_conninfo
        cls.db,cls.passages,cls.notebook,cls.lexicon,cls.search,cls.sql=db,passage_store,notebook,lexicon_store,research_search,sql
        cls.dsn=os.environ['RESEARCH_TEST_DATABASE_URL']
        cls.owner,cls.public='search_owner_'+uuid.uuid4().hex,'search_public_'+uuid.uuid4().hex
        with db.connect(cls.dsn) as connection:
            db.migrate(connection)
            for role in (cls.owner,cls.public):connection.execute(sql.SQL('CREATE ROLE {} LOGIN').format(sql.Identifier(role)))
            connection.commit();configure(connection,cls.owner,cls.public,apply=True)
        cls.owner_dsn=make_conninfo(cls.dsn,user=cls.owner);cls.public_dsn=make_conninfo(cls.dsn,user=cls.public)

    @classmethod
    def tearDownClass(cls):
        with cls.db.connect(cls.dsn) as connection:
            for role in (cls.owner,cls.public):
                connection.execute(cls.sql.SQL('DROP OWNED BY {}').format(cls.sql.Identifier(role)))
                connection.execute(cls.sql.SQL('DROP ROLE {}').format(cls.sql.Identifier(role)))

    def setUp(self):
        self.project,self.other='test:'+uuid.uuid4().hex,'test:'+uuid.uuid4().hex
        self.source='test:'+uuid.uuid4().hex
        with self.db.connect(self.owner_dsn) as connection:
            self.db.create_project(connection,self.project,'Synthetic search project')
            self.db.create_project(connection,self.other,'Other synthetic project')
            self.db.save_record(connection,record_id=self.source,project_id=self.project,kind='source',title='A synthetic source',summary='Metadata only',actor='owner')
            self.text='😀 A hidden bibliographicneedle inside this immutable excerpt. tafsīr %_ literal. العربية'
            self.document=self.passages.create_document(connection,project_id=self.project,source_record_id=self.source,
                edition='Synthetic edition',locator='Synthetic page 2',representation_url='',text=self.text,actor='owner')
            self.annotation=self.passages.create_annotation(connection,annotation_uuid=str(uuid.uuid4()),project_id=self.project,
                document_id=self.document['id'],text_sha256=self.document['text_sha256'],start=0,end=len(self.text),exact=self.text,
                capture_kind='comment',body='A passagebodyneedle note',actor='owner')
            self.db.save_personal_state(connection,record_id=self.source,project_id=self.project,expected_revision=0,
                reading='reading',decision='read_later',note='A personalbodyneedle note',actor='owner')
            self.thought=self.notebook.create(connection,request_uuid=str(uuid.uuid4()),project_id=self.project,thought_type='question',
                title='A thoughtbodyneedle question',body='My question, unreviewed',links=[],actor='owner',record_id=self.source,
                document_id=self.document['id'],annotation_id=self.annotation['id'])

    def find(self,query,**patch):
        with self.db.connect(self.owner_dsn) as connection:
            return self.search.search(connection,patch.get('project_id',self.project),query,patch.get('limit',30))

    def test_document_text_notes_thoughts_and_project_boundaries(self):
        documents=[r for r in self.find('bibliographicneedle')['items'] if r['kind']=='document']
        self.assertEqual(len(documents),1)
        row=documents[0]
        for key,value in dict(document_id=self.document['id'],record_id=self.source,text_sha256=self.document['text_sha256'],
                              edition='Synthetic edition',locator='Synthetic page 2').items():self.assertEqual(row[key],value)
        self.assertEqual(row['revision'],None)
        passage=self.find('passagebodyneedle')['items'][0]
        self.assertEqual(passage['kind'],'passage_note');self.assertEqual(passage['annotation_id'],self.annotation['id'])
        personal=self.find('personalbodyneedle')['items'][0]
        self.assertEqual(personal['kind'],'record_note');self.assertEqual(personal['revision'],1)
        thought=self.find('thoughtbodyneedle')['items'][0]
        self.assertEqual(thought['kind'],'thought');self.assertEqual(thought['thought_type'],'question')
        self.assertEqual(thought['entry_id'],self.thought['id'])
        self.assertEqual(self.find('needle',project_id=self.other)['items'],[])
        with self.db.connect(self.owner_dsn) as connection:
            self.db.save_personal_state(connection,record_id=self.source,project_id=self.project,expected_revision=1,
                reading='read',decision='relevant',note='A revisedbodyneedle note',actor='owner')
        self.assertEqual(self.find('personalbodyneedle')['items'],[])
        self.assertEqual(self.find('revisedbodyneedle')['items'][0]['revision'],2)

    def test_literal_query_unicode_stable_ranking_and_explicit_truncation(self):
        self.assertEqual(self.find("%_' OR true --")['items'],[])
        self.assertTrue(any(row['kind']=='document' for row in self.find('%_')['items']))
        self.assertTrue(any(row['kind']=='document' for row in self.find('العربية')['items']))
        with self.db.connect(self.owner_dsn) as connection:
            for title in ['Rankingneedle','Rankingneedle prefixed','Other title']:
                self.db.save_record(connection,record_id='test:'+uuid.uuid4().hex,project_id=self.project,kind='claim',
                    title=title,summary='Rankingneedle in a summary',actor='owner')
        results=self.find('Rankingneedle',limit=2)
        self.assertTrue(results['truncated'])
        self.assertEqual([r['title'] for r in results['items']],['Rankingneedle','Rankingneedle prefixed'])
        self.assertEqual(results,self.find('Rankingneedle',limit=2))

    def test_library_only_lists_real_saved_versions_paging_and_state(self):
        with self.db.connect(self.owner_dsn) as connection:
            self.db.save_record(connection,record_id='test:'+uuid.uuid4().hex,project_id=self.project,kind='source',title='Metadata without text',actor='owner')
            second=self.passages.create_document(connection,project_id=self.project,source_record_id=self.source,
                edition='Another edition',locator='p. 3',representation_url='',text='Another saved version',actor='owner')
            first=self.search.library(connection,self.project,'',1)
            after=self.search.library(connection,self.project,first['next_cursor'],1)
            self.assertEqual({first['items'][0]['document_id'],after['items'][0]['document_id']},{self.document['id'],second['id']})
            self.assertIsNone(after['next_cursor'])
            self.assertEqual(first['items'][0]['reading'],'reading')
            self.assertEqual(first['items'][0]['decision'],'read_later')
            self.assertEqual(first['items'][0]['state_revision'],1)
            self.assertEqual(self.search.library(connection,self.other)['items'],[])

    def test_deleted_or_withdrawn_sources_and_thoughts_are_excluded(self):
        with self.db.connect(self.owner_dsn) as connection:
            self.notebook.update(connection,project_id=self.project,entry_id=self.thought['id'],expected_revision=1,
                thought_type='question',title='A thoughtbodyneedle question',body='Withdrawn',links=[],state='withdrawn',actor='owner')
        self.assertEqual(self.find('thoughtbodyneedle')['items'],[])
        with self.db.connect(self.dsn) as connection:
            connection.execute("UPDATE research.records SET review_state='withdrawn',revision=revision+1 WHERE id=%s",(self.source,))
        for term in ['bibliographicneedle','personalbodyneedle','passagebodyneedle']:
            self.assertEqual(self.find(term)['items'],[])
        with self.db.connect(self.owner_dsn) as connection:
            self.assertEqual(self.search.library(connection,self.project)['items'],[])
        with self.db.connect(self.dsn) as connection:
            connection.execute("UPDATE research.records SET review_state='pending',deleted_at=clock_timestamp(),revision=revision+1 WHERE id=%s",(self.source,))
        self.assertEqual(self.find('bibliographicneedle')['items'],[])

    def test_scoped_concepts_spelling_definitions_and_withdrawal(self):
        with self.db.connect(self.owner_dsn) as connection:
            start=self.text.index('tafsīr')
            capture=self.lexicon.capture(connection,request_uuid=str(uuid.uuid4()),project_id=self.project,annotation_id=self.annotation['id'],
                start=start,end=start+6,entry=dict(entry_type='word',scope='Synthetic scoped use',language_tag='ar-Latn',script_tag='Latn',transliteration_scheme='Unspecified'),
                representation_id=None,concept=dict(mode='new',title='Interpretation conceptneedle',scope='Synthetic scope',language_tag='en'),
                sense_id=None,sense_scope='Only this fixture',rationale='Synthetic connection',actor='owner')
            definition=self.lexicon.create_definition(connection,definition_uuid=str(uuid.uuid4()),project_id=self.project,concept_id=capture['concept_id'],
                sense_id=capture['sense_id'],annotation_id=self.annotation['id'],definition_kind='owner_paraphrase',wording_mode='paraphrase',body='A definitionbodyneedle',
                attribution='Synthetic owner',attribution_person_id=None,scope='This fixture only',dating_note='',rationale='Synthetic located support',
                proposal_tool='',proposal_version='',proposal_activity='',actor='owner')
        self.assertEqual(self.find('conceptneedle')['items'][0]['concept_id'],capture['concept_id'])
        spelling=[r for r in self.find('tafsīr')['items'] if r['channel']=='lexicon_spelling']
        self.assertEqual(spelling[0]['concept_id'],capture['concept_id'])
        row=self.find('definitionbodyneedle')['items'][0]
        self.assertEqual(row['kind'],'definition');self.assertEqual(row['id'],definition['id'])
        self.assertEqual(row['source_record_id'],self.source);self.assertEqual(row['annotation_id'],self.annotation['id'])
        with self.db.connect(self.owner_dsn) as connection:
            self.lexicon.update_definition(connection,project_id=self.project,definition_id=definition['id'],expected_revision=1,
                wording_mode='paraphrase',body='A definitionbodyneedle',attribution='Synthetic owner',scope='This fixture only',
                dating_note='',rationale='Synthetic located support',state='withdrawn',actor='owner')
        self.assertEqual(self.find('definitionbodyneedle')['items'],[])
        with self.db.connect(self.owner_dsn) as connection:
            connection.execute("UPDATE research.lexicon_senses SET state='withdrawn',revision=revision+1 WHERE id=%s",(capture['sense_id'],))
        self.assertEqual(self.find('definitionbodyneedle')['items'],[])
        self.assertFalse(any(r['channel']=='lexicon_spelling' for r in self.find('tafsīr')['items']))

    def test_public_database_role_cannot_run_owner_search_or_library(self):
        from psycopg.errors import InsufficientPrivilege
        for operation in [lambda c:self.search.search(c,self.project,'needle'),lambda c:self.search.library(c,self.project)]:
            with self.db.connect(self.public_dsn) as connection:
                with self.assertRaises(InsufficientPrivilege):operation(connection)
