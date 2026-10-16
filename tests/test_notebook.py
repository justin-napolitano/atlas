import os
import unittest
import uuid

from islam_research.notebook import metadata


class NotebookValidationTests(unittest.TestCase):
    def test_thought_roles_and_explicit_link_reasons_are_bounded(self):
        for kind in ['note','question','source_claim','interpretation','objection']:
            self.assertEqual(metadata(kind,'Thought','Markdown **source**',[],'active')['thought_type'],kind)
        for patch in [dict(thought_type='reviewed'),dict(body=' '),dict(links=[dict(kind='record',id='x',rationale='')]),
                      dict(links=[dict(kind='record',id='x',rationale='why')]*2),dict(links=[dict(kind='sql',id='x',rationale='why')])]:
            with self.subTest(patch=patch),self.assertRaises(ValueError):
                metadata(**{**dict(thought_type='note',title='Thought',body='Body',links=[],state='active'),**patch})


@unittest.skipUnless(os.environ.get('RESEARCH_TEST_DATABASE_URL'),'Requires real isolated PostgreSQL')
class NotebookStoreTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from islam_research import database as db,notebook,passage_store
        from islam_research.sql_permissions import configure
        from psycopg import sql
        from psycopg.conninfo import make_conninfo
        cls.db,cls.store,cls.passages,cls.sql=db,notebook,passage_store,sql
        cls.dsn=os.environ['RESEARCH_TEST_DATABASE_URL'];cls.owner='notebook_owner_'+uuid.uuid4().hex;cls.publisher='notebook_reader_'+uuid.uuid4().hex
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
        self.project='test:'+uuid.uuid4().hex;self.source='test:'+uuid.uuid4().hex
        with self.db.connect(self.owner_dsn) as connection:
            self.db.create_project(connection,self.project,'Synthetic notebook')
            self.db.save_record(connection,record_id=self.source,project_id=self.project,kind='source',title='Synthetic source',actor='owner')
            self.document=self.passages.create_document(connection,project_id=self.project,source_record_id=self.source,edition='Synthetic edition',locator='p. 2',
                representation_url='',text='😀 tafsīr and evidence',actor='owner')
            self.annotation=self.passages.create_annotation(connection,annotation_uuid=str(uuid.uuid4()),project_id=self.project,document_id=self.document['id'],
                text_sha256=self.document['text_sha256'],start=2,end=8,exact='tafsīr',capture_kind='comment',body='Original passage notebook marker',actor='owner')
        self.values=dict(request_uuid=str(uuid.uuid4()),project_id=self.project,thought_type='question',title='A running question',body='How should I read this?',links=[],actor='owner',
            record_id=self.source,document_id=self.document['id'],annotation_id=self.annotation['id'])

    def test_two_sessions_replay_edit_conflict_history_and_withdrawal(self):
        with self.db.connect(self.owner_dsn) as connection:
            saved=self.store.create(connection,**self.values);self.assertFalse(saved['replayed'])
        with self.db.connect(self.owner_dsn) as connection:
            first=self.store.get(connection,self.project,saved['id']);self.assertEqual(first['selected_quote'],'tafsīr')
            patch=dict(project_id=self.project,entry_id=saved['id'],expected_revision=1,thought_type='interpretation',title=first['title'],body='My revised reading',links=[],state='active',actor='owner')
            revised=self.store.update(connection,**patch);self.assertEqual(revised,self.store.update(connection,**patch))
            retry=self.store.create(connection,**self.values);self.assertTrue(retry['replayed']);self.assertEqual(retry['revision'],2)
            with self.assertRaises(self.db.RevisionConflict):self.store.update(connection,**{**patch,'body':'Another device thought'})
            with self.assertRaises(self.db.RevisionConflict):self.store.create(connection,**{**self.values,'body':'Changed uncertain request'})
            withdrawn=self.store.update(connection,**{**patch,'expected_revision':2,'state':'withdrawn'});self.assertEqual(withdrawn['revision'],3)
            rows=self.store.items(connection,self.project,'','', 'active','',25);self.assertEqual([r['item_kind'] for r in rows],['passage_note'])
            history=self.store.history(connection,self.project,saved['id'],None,2);self.assertEqual([r['revision'] for r in history],[3,2])
            self.assertEqual(self.store.history(connection,self.project,saved['id'],2,25)[0]['snapshot']['body'],self.values['body'])
            self.assertIsNone(self.store.get(connection,'other',saved['id']));self.assertIsNone(self.store.history(connection,'other',saved['id'],None,25))

    def test_network_is_bounded_private_current_project_projection(self):
        with self.db.connect(self.owner_dsn) as connection:
            first=self.store.create(connection,**self.values)
            second=self.store.create(connection,**{**self.values,'request_uuid':str(uuid.uuid4()),'title':'An independent note',
                'record_id':None,'document_id':None,'annotation_id':None,'links':[dict(kind='entry',id=first['id'],rationale='Compare this question')]})
            rows=self.store.network(connection,self.project,1)
            self.assertEqual(len(rows),1)
            all_rows=self.store.network(connection,self.project,201)
            self.assertEqual(len(all_rows),2)
            self.assertEqual(next(row for row in all_rows if row['id']==second['id'])['links'][0]['id'],first['id'])
            self.assertNotIn('changed_by',rows[0])
            self.assertEqual(self.store.network(connection,'other',201),[])
            self.store.update(connection,project_id=self.project,entry_id=first['id'],expected_revision=1,
                **metadata(self.values['thought_type'],self.values['title'],self.values['body'],[],'withdrawn'),actor='owner')
            self.assertEqual([row['id'] for row in self.store.network(connection,self.project,201)],[second['id']])
            for limit in [0,202,True]:
                with self.assertRaises(ValueError):self.store.network(connection,self.project,limit)

    def test_existing_passage_note_is_live_single_authority_and_filters_page_before_limit(self):
        with self.db.connect(self.owner_dsn) as connection:
            saved=self.store.create(connection,**self.values)
            self.assertEqual([r['id'] for r in self.store.items(connection,self.project,'','','active','',1,item_scope='writing')],[saved['id']])
            self.assertEqual([r['item_kind'] for r in self.store.items(connection,self.project,'','','active','',1,item_scope='reading')],['passage_note'])
            with self.assertRaises(ValueError):self.store.items(connection,self.project,'','','active','',25,item_scope='unknown')
            rows=self.store.items(connection,self.project,'tafsīr','passage_note','active','',1)
            self.assertEqual(rows[0]['annotation_id'],self.annotation['id']);self.assertEqual(rows[0]['body'],'Original passage notebook marker')
            self.passages.update_annotation(connection,annotation_id=self.annotation['id'],project_id=self.project,expected_revision=1,body='Corrected passage body',actor='owner')
            rows=self.store.items(connection,self.project,'Corrected','passage_note','active','',25);self.assertEqual(rows[0]['revision'],2)
            self.assertEqual(self.store.get(connection,self.project,saved['id'])['body'],self.values['body'])
            first=self.store.items(connection,self.project,'','','active','',1)
            following=self.store.items(connection,self.project,'','','active',first[0]['cursor'],1)
            self.assertNotEqual(first[0]['id'],following[0]['id'])
            self.assertEqual(self.store.items(connection,'other','','','active','',25),[])
            self.db.save_personal_state(connection,record_id=self.source,project_id=self.project,note='Record-only reflection',actor='owner')
            record_notes=self.store.items(connection,self.project,'reflection','record_note','active','',25)
            self.assertEqual(record_notes[0]['record_id'],self.source);self.assertIsNone(record_notes[0]['annotation_id'])
            self.db.save_personal_state(connection,record_id=self.source,project_id=self.project,note='Updated record reflection',actor='owner',expected_revision=1)
            self.assertEqual(self.store.items(connection,self.project,'Updated','record_note','active','',25)[0]['revision'],2)

    def test_source_claim_requires_exact_anchor_links_require_reason_and_project(self):
        from psycopg.errors import CheckViolation,ForeignKeyViolation
        with self.db.connect(self.owner_dsn) as connection:
            with self.assertRaises(ValueError):self.store.create(connection,**{**self.values,'thought_type':'source_claim','annotation_id':None})
            claim=self.store.create(connection,**{**self.values,'thought_type':'source_claim','links':[dict(kind='record',id=self.source,rationale='Context for this question')]})
            self.assertEqual(self.store.get(connection,self.project,claim['id'])['review_state'],'pending')
            for change in [dict(annotation_id='other'),dict(document_id='other'),dict(record_id='other'),dict(links=[dict(kind='record',id='other',rationale='Foreign target')])]:
                with self.subTest(change=change),self.assertRaises((ValueError,CheckViolation,ForeignKeyViolation)):
                    with connection.transaction():self.store.create(connection,**{**self.values,'request_uuid':str(uuid.uuid4()),**change})
            self.assertEqual(len(self.store.history(connection,self.project,claim['id'],None,25)),1)

    def test_restricted_roles_and_sql_cannot_retarget_promote_or_rewrite_history(self):
        from psycopg.errors import CheckViolation,InsufficientPrivilege
        with self.db.connect(self.owner_dsn) as connection:
            saved=self.store.create(connection,**self.values)
            for statement in ['UPDATE research.notebook_entries SET review_state=\'reviewed\'', 'DELETE FROM research.notebook_entries',
                              'UPDATE research.notebook_revisions SET snapshot=\'{}\'']:
                with self.assertRaises(InsufficientPrivilege):
                    with connection.transaction():connection.execute(statement)
            with self.assertRaises(CheckViolation):
                with connection.transaction():connection.execute('UPDATE research.notebook_entries SET revision=revision+2 WHERE id=%s',(saved['id'],))
            with self.assertRaises(CheckViolation):
                with connection.transaction():connection.execute("UPDATE research.notebook_entries SET links='[{\"kind\":\"record\",\"id\":\"bad\",\"rationale\":\"\"}]',revision=revision+1 WHERE id=%s",(saved['id'],))
        with self.db.connect(self.publisher_dsn) as connection:
            for table in ['notebook_entries','notebook_revisions']:
                with self.assertRaises(InsufficientPrivilege):
                    with connection.transaction():connection.execute('SELECT * FROM research.'+table)

    def test_publication_excludes_notebook_body_and_links(self):
        import json
        from islam_research import publication
        with self.db.connect(self.owner_dsn) as connection:
            saved=self.store.create(connection,**self.values)
            preview=publication.preview(connection,project_id=self.project,selections=[dict(record_id=self.source,include_summary=True,include_bibliography=True)],relation_ids=[],actor='owner')
            payload=json.dumps(preview['payload'],default=str)
            for private in [saved['id'],self.values['body'],self.annotation['id']]:self.assertNotIn(private,payload)

    def test_signed_owner_http_roundtrip_uses_restricted_database_and_exact_backlinks(self):
        import time
        import jwt
        from cryptography.hazmat.primitives.asymmetric import ec
        from fastapi.testclient import TestClient
        from islam_research.api import Settings,create_app
        from islam_research.api_auth import IAPVerifier,IAP_ISSUER
        settings=Settings(self.owner_dsn,owner_subject='synthetic-owner',iap_audience='/projects/123/locations/us-central1/services/synthetic',owner_origin='https://owner.example.invalid')
        key=ec.generate_private_key(ec.SECP256R1());verifier=IAPVerifier(settings.iap_audience,settings.owner_subject,loader=lambda:{'synthetic':key.public_key()})
        token=jwt.encode(dict(iss=IAP_ISSUER,aud=settings.iap_audience,sub=settings.owner_subject,iat=int(time.time()),exp=int(time.time())+600),key,algorithm='ES256',headers={'kid':'synthetic'})
        headers={'x-goog-iap-jwt-assertion':token,'x-research-write':'1','origin':settings.owner_origin}
        first=TestClient(create_app(settings,verifier=verifier));second=TestClient(create_app(settings,verifier=verifier))
        value={**self.values,'owner_confirmed':True};value.pop('actor')
        response=first.post('/v1/notebook/entries',json=value,headers=headers);self.assertEqual(response.status_code,201,response.text);identifier=response.json()['id']
        params=dict(project_id=self.project,entry_id=identifier)
        row=second.get('/v1/notebook/entry',params=params,headers=headers).json();self.assertEqual(row['selected_quote'],'tafsīr')
        self.assertEqual(row['changed_by'],settings.owner_subject)
        update={**params,'expected_revision':1,'owner_confirmed':True,**{key:row[key] for key in ['thought_type','title','body','links','state']}}
        update['body']='HTTP correction marker'
        self.assertEqual(first.put('/v1/notebook/entry',json=update,headers=headers).status_code,200)
        self.assertEqual(second.put('/v1/notebook/entry',json={**update,'body':'Stale other thought'},headers=headers).status_code,409)
        history=second.get('/v1/notebook/history',params={**params,'limit':1},headers=headers).json();self.assertEqual(history['items'][0]['revision'],2)
        search=second.get('/v1/notebook/items',params=dict(project_id=self.project,q='correction',limit=1),headers=headers).json();self.assertEqual(search['items'][0]['id'],identifier)
        self.assertEqual(second.get('/v1/notebook/entry',params={**params,'project_id':'other'},headers=headers).status_code,404)
