import os
import unittest
import uuid


@unittest.skipUnless(os.environ.get('RESEARCH_TEST_DATABASE_URL'),'Requires real isolated PostgreSQL')
class ReadingDraftTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from islam_research import database as db,reading_drafts,passage_store
        from islam_research.sql_permissions import configure
        from psycopg import sql
        from psycopg.conninfo import make_conninfo
        cls.db,cls.store,cls.passages,cls.sql=db,reading_drafts,passage_store,sql
        cls.dsn=os.environ['RESEARCH_TEST_DATABASE_URL'];cls.owner='draft_owner_'+uuid.uuid4().hex;cls.publisher='draft_reader_'+uuid.uuid4().hex
        with db.connect(cls.dsn) as connection:
            db.migrate(connection)
            for role in (cls.owner,cls.publisher):connection.execute(sql.SQL('CREATE ROLE {} LOGIN').format(sql.Identifier(role)))
            connection.commit();configure(connection,cls.owner,cls.publisher,apply=True)
        cls.owner_dsn=make_conninfo(cls.dsn,user=cls.owner);cls.publisher_dsn=make_conninfo(cls.dsn,user=cls.publisher)

    @classmethod
    def tearDownClass(cls):
        with cls.db.connect(cls.dsn) as connection:
            for role in (cls.owner,cls.publisher):
                connection.execute(cls.sql.SQL('DROP OWNED BY {}').format(cls.sql.Identifier(role)))
                connection.execute(cls.sql.SQL('DROP ROLE {}').format(cls.sql.Identifier(role)))

    def setUp(self):
        self.project='test:'+uuid.uuid4().hex;self.source='test:'+uuid.uuid4().hex;self.uuid=str(uuid.uuid4())
        with self.db.connect(self.owner_dsn) as connection:
            self.db.create_project(connection,self.project,'Synthetic draft project')
            self.db.save_record(connection,record_id=self.source,project_id=self.project,kind='source',title='Synthetic source',actor='owner')
            self.document=self.passages.create_document(connection,project_id=self.project,source_record_id=self.source,edition='Synthetic edition',locator='Section 1',representation_url='',text='😀 tafsīr and التفسير.',actor='owner')
            self.annotation=self.passages.create_annotation(connection,annotation_uuid=str(uuid.uuid4()),project_id=self.project,document_id=self.document['id'],text_sha256=self.document['text_sha256'],start=2,end=8,exact='tafsīr',capture_kind='comment',body='Original saved note',actor='owner')
        self.payload=dict(draft_uuid=self.uuid,project_id=self.project,record_id=self.source,context_kind='capture',document_id=self.document['id'],annotation_id=None,text_sha256=self.document['text_sha256'],start=2,end=8,exact='tafsīr',capture_kind='comment',base_revision=0,body='SYNTHETIC unfinished margin note 😀',mark_style='underline',state='active',expected_revision=0,actor='owner')

    def save(self,connection,**patch):return self.store.save(connection,**{**self.payload,**patch})
    def listing(self,connection,**patch):return self.store.listing(connection,**{**dict(project_id=self.project,record_id=self.source,document_id=None,annotation_id=None,context_kind=None,state='active',cursor='',limit=25),**patch})

    def test_cross_connection_recovery_exact_retry_history_and_discard_restore(self):
        with self.db.connect(self.owner_dsn) as connection:
            first=self.save(connection);self.assertEqual(first,self.save(connection));self.assertEqual(first['revision'],1)
            self.assertEqual(first['exact'],'tafsīr');self.assertEqual(first['prefix'],'😀 ')
        with self.db.connect(self.owner_dsn) as other:
            self.assertEqual(self.store.get(other,self.project,first['id']),first)
            updated=self.save(other,expected_revision=1,body='Second private version');self.assertEqual(updated,self.save(other,expected_revision=1,body='Second private version'))
            with self.assertRaises(self.db.RevisionConflict) as error:self.save(other,expected_revision=1,body='Conflicting local version')
            self.assertEqual(error.exception.current['body'],'Second private version')
            separate=self.save(other,draft_uuid=str(uuid.uuid4()),body='Conflicting local version');self.assertNotEqual(separate['id'],first['id'])
            discarded=self.save(other,expected_revision=2,body='Second private version',state='discarded');self.assertEqual(discarded['revision'],3)
            self.assertEqual(len(self.listing(other)),1);self.assertEqual(self.listing(other,state='discarded')[0]['id'],first['id'])
            restored=self.save(other,expected_revision=3,body='Second private version',state='active');self.assertEqual(restored['revision'],4)
            self.assertEqual(len(self.store.history(other,self.project,first['id'],None,25)),4)
            self.assertEqual(self.store.history(other,self.project,first['id'],3,1)[0]['revision'],2)
            self.assertEqual(self.passages.annotation(other,self.project,self.annotation['id'])['annotation']['body'],'Original saved note')
            self.assertIsNone(other.execute('SELECT * FROM research.personal_states WHERE record_id=%s',(self.source,)).fetchone())
            self.assertIsNone(self.store.get(other,'other',first['id']));self.assertIsNone(self.store.history(other,'other',first['id'],None,25))

    def test_annotation_and_general_record_note_baselines_are_derived_from_history(self):
        with self.db.connect(self.owner_dsn) as connection:
            revised=self.passages.update_annotation(connection,project_id=self.project,annotation_id=self.annotation['id'],body='Cloud changed note',mark_style='none',expected_revision=1,actor='owner')
            draft=self.save(connection,context_kind='annotation',annotation_id=self.annotation['id'],base_revision=1)
            self.assertEqual(draft['base_snapshot'],dict(body='Original saved note',mark_style='highlight',revision=1))
            self.assertEqual(revised['revision'],2)
            concept='test:'+uuid.uuid4().hex
            self.db.save_record(connection,record_id=concept,project_id=self.project,kind='concept',title='Synthetic concept',actor='owner')
            self.db.save_personal_state(connection,record_id=concept,project_id=self.project,actor='owner',note='Original record note')
            value=self.save(connection,draft_uuid=str(uuid.uuid4()),record_id=concept,context_kind='record_note',document_id=None,annotation_id=None,text_sha256=None,start=None,end=None,exact='',capture_kind=None,base_revision=1,mark_style='none')
            self.assertEqual(value['base_snapshot'],dict(note='Original record note',revision=1))
            with self.assertRaises(Exception):
                with connection.transaction():self.save(connection,draft_uuid=str(uuid.uuid4()),context_kind='annotation',annotation_id=self.annotation['id'],base_revision=999)

    def test_source_baseline_and_selector_are_immutable_and_project_isolated(self):
        with self.db.connect(self.owner_dsn) as connection:
            first=self.save(connection)
            for patch in [dict(exact='wrong'),dict(text_sha256='a'*64),dict(start=1),dict(document_id='missing'),dict(record_id='missing'),dict(project_id='other'),dict(context_kind='record_note'),dict(base_revision=1)]:
                with self.assertRaises(ValueError):self.save(connection,**patch)
            with self.assertRaises(ValueError):self.save(connection,expected_revision=1,start=9,end=12,exact='and')
            self.assertEqual(len(self.store.history(connection,self.project,first['id'],None,25)),1)
            self.assertEqual(self.listing(connection,document_id='other'),[])

    def test_sql_rejects_forged_anchor_revision_baseline_and_history_writes(self):
        from psycopg.errors import CheckViolation,InsufficientPrivilege
        with self.db.connect(self.owner_dsn) as connection:
            first=self.save(connection)
            for statement in ['revision=revision+2','state=\'invalid\',revision=revision+1']:
                with self.assertRaises(CheckViolation):
                    with connection.transaction():connection.execute('UPDATE research.reading_drafts SET '+statement+' WHERE id=%s',(first['id'],))
            for statement in ['exact=\'other\'',"base_snapshot='{}'",'base_revision=99','record_id=\'other\'']:
                with self.assertRaises(InsufficientPrivilege):
                    with connection.transaction():connection.execute('UPDATE research.reading_drafts SET '+statement+' WHERE id=%s',(first['id'],))
            with self.assertRaises(InsufficientPrivilege):
                with connection.transaction():connection.execute('DELETE FROM research.reading_drafts WHERE id=%s',(first['id'],))
            with self.assertRaises(InsufficientPrivilege):
                with connection.transaction():connection.execute("UPDATE research.reading_draft_revisions SET snapshot='{}' WHERE draft_id=%s",(first['id'],))
            # Runtime can INSERT allowed columns; SQL trigger must still reject a forged exact selector.
            with self.assertRaises(CheckViolation):
                with connection.transaction():connection.execute('''INSERT INTO research.reading_drafts(id,project_id,record_id,context_kind,document_id,text_sha256,start_pos,end_pos,exact,prefix,suffix,capture_kind,base_revision,body,mark_style,state,changed_by)
                    VALUES(%s,%s,%s,'capture',%s,%s,2,8,'forged','😀 ',' and التفسير.','comment',0,'private','none','active','owner')''',('urn:research:draft:'+str(uuid.uuid4()),self.project,self.source,self.document['id'],self.document['text_sha256']))
        with self.db.connect(self.publisher_dsn) as connection:
            for table in ['reading_drafts','reading_draft_revisions']:
                with self.assertRaises(InsufficientPrivilege):
                    with connection.transaction():connection.execute('SELECT * FROM research.'+table)

    def test_two_simultaneous_sessions_keep_losing_version_out_of_current_row(self):
        from concurrent.futures import ThreadPoolExecutor
        from threading import Barrier
        barrier=Barrier(2)
        with self.db.connect(self.owner_dsn) as connection:self.save(connection)
        def attempt(body):
            with self.db.connect(self.owner_dsn) as connection:
                barrier.wait()
                try:return 'saved',self.save(connection,expected_revision=1,body=body)
                except self.db.RevisionConflict as error:return 'conflict',error.current
        with ThreadPoolExecutor(max_workers=2) as executor:results=list(executor.map(attempt,['Session A draft','Session B draft']))
        self.assertEqual(sorted(row[0] for row in results),['conflict','saved']);self.assertEqual(results[0][1],results[1][1])
        with self.db.connect(self.owner_dsn) as connection:self.assertEqual(len(self.store.history(connection,self.project,results[0][1]['id'],None,25)),2)

    def test_explicit_publication_excludes_drafts_and_their_selectors(self):
        import json
        from islam_research import publication
        with self.db.connect(self.owner_dsn) as connection:
            draft=self.save(connection)
            preview=publication.preview(connection,project_id=self.project,selections=[dict(record_id=self.source,include_summary=True,include_bibliography=True)],relation_ids=[],actor='owner')
            public=json.dumps(preview['payload'],default=str)
            for private in [draft['id'],draft['body'],self.document['id'],self.document['text_sha256']]:self.assertNotIn(private,public)

    def test_real_signed_http_save_recover_conflict_and_history(self):
        import time,jwt
        from cryptography.hazmat.primitives.asymmetric import ec
        from fastapi.testclient import TestClient
        from islam_research.api import Settings,create_app
        from islam_research.api_auth import IAPVerifier,IAP_ISSUER
        key=ec.generate_private_key(ec.SECP256R1());audience='/projects/123456789012/locations/us-central1/services/synthetic-owner';origin='https://research.example.invalid'
        verifier=IAPVerifier(audience,'synthetic-owner',loader=lambda:{'test-key':key.public_key()})
        app=create_app(Settings(self.owner_dsn,owner_subject='synthetic-owner',iap_audience=audience,owner_origin=origin),verifier=verifier)
        now=int(time.time());token=jwt.encode(dict(iss=IAP_ISSUER,aud=audience,sub='synthetic-owner',iat=now,exp=now+600),key,algorithm='ES256',headers={'kid':'test-key'})
        headers={'x-goog-iap-jwt-assertion':token,'x-research-write':'1','origin':origin};payload={k:v for k,v in self.payload.items() if k!='actor'}
        with TestClient(app) as client:
            response=client.put('/v1/reading/draft',json=payload,headers=headers);self.assertEqual(response.status_code,200,response.text);row=response.json()
            self.assertEqual(client.put('/v1/reading/draft',json=payload,headers=headers).json(),row)
            self.assertEqual(client.get('/v1/reading/draft',params=dict(project_id=self.project,draft_id=row['id']),headers=headers).json()['body'],payload['body'])
            self.assertEqual(client.get('/v1/reading/drafts',params=dict(project_id=self.project,record_id=self.source),headers=headers).json()['items'][0]['id'],row['id'])
            self.assertEqual(client.get('/v1/reading/draft-history',params=dict(project_id=self.project,draft_id=row['id']),headers=headers).json()['items'][0]['revision'],1)
            self.assertEqual(client.put('/v1/reading/draft',json={**payload,'body':'Different'},headers=headers).status_code,409)
            self.assertEqual(client.get('/v1/reading/draft',params=dict(project_id='other',draft_id=row['id']),headers=headers).status_code,404)
            self.assertEqual(client.put('/v1/reading/draft',json={**payload,'actor':'forged'},headers=headers).status_code,422)
