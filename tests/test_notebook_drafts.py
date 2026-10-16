import os
import unittest
import uuid

import test_api as boundary


class NotebookDraftBoundaryTests(unittest.TestCase):
    setUp = boundary.APIBoundaryTests.setUp
    headers = boundary.APIBoundaryTests.headers

    def test_recovery_is_strict_owner_only_and_not_a_confirmed_note(self):
        class Store(boundary.MemoryBoundaryStore):
            def save_notebook_draft(self, **values):
                return {**values, 'revision': 1}
            def notebook_drafts(self, *args): return []
            def notebook_draft(self, *args): return None
        client = boundary.TestClient(boundary.create_app(self.settings, store=Store(), verifier=self.verifier))
        value = dict(project_id='synthetic:project', draft_uuid=str(uuid.uuid4()), request_uuid=str(uuid.uuid4()),
                     base_revision=0, expected_revision=0, value=dict(title='', body='Unfinished synthetic text', links=[], state='active', thought_type='question'))
        response = client.put('/v1/notebook/draft', json=value, headers=self.headers())
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['actor'], boundary.OWNER)
        for patch in [dict(actor='forged'), dict(base_snapshot={}), dict(expected_revision=-1), dict(value={**value['value'], 'review_state':'reviewed'})]:
            self.assertEqual(client.put('/v1/notebook/draft', json={**value, **patch}, headers=self.headers()).status_code, 422)
        self.assertEqual(client.put('/v1/notebook/draft', json=value).status_code, 401)
        self.assertEqual(client.put('/v1/notebook/draft', json=value, headers=self.headers(sub='other')).status_code, 403)
        self.assertEqual(client.put('/v1/notebook/draft', json=value, headers=self.headers(origin='https://other.invalid')).status_code, 403)
        self.assertIn('no-store', client.get('/v1/notebook/drafts', params=dict(project_id='synthetic:project'), headers=self.headers()).headers['cache-control'])
        public = boundary.TestClient(boundary.create_app(boundary.Settings('synthetic',mode='public'), store=Store()))
        for path in ['/v1/notebook/draft', '/v1/notebook/drafts']:
            self.assertEqual(public.get(path).status_code, 404)
        self.assertEqual(public.put('/v1/notebook/draft', json=value).status_code, 404)


@unittest.skipUnless(os.environ.get('RESEARCH_TEST_DATABASE_URL'), 'Requires real isolated PostgreSQL')
class NotebookDraftStoreTests(unittest.TestCase):
    from test_notebook import NotebookStoreTests as Setup
    setUpClass = classmethod(Setup.setUpClass.__func__)
    tearDownClass = classmethod(Setup.tearDownClass.__func__)
    setUp = Setup.setUp

    def payload(self, **patch):
        return dict(draft_uuid=str(uuid.uuid4()), project_id=self.project, entry_id=None,
                    request_uuid=str(uuid.uuid4()), record_id=None, document_id=None, annotation_id=None,
                    base_revision=0, expected_revision=0, state='active', actor='owner',
                    value=dict(thought_type='question', title='', body='  Synthetic unfinished writing 😀\n', links=[], state='active'), **patch)

    def test_cross_session_recovery_retry_conflict_and_discard(self):
        from islam_research import notebook_drafts as recovery
        values=self.payload()
        with self.db.connect(self.owner_dsn) as connection:
            first=recovery.save(connection, **values)
            self.assertEqual(first, recovery.save(connection, **values))
            self.assertEqual(self.store.items(connection,self.project,'','','active','',25,item_scope='writing'), [])
        with self.db.connect(self.owner_dsn) as other:
            self.assertEqual(recovery.get(other,self.project,first['id']), first)
            self.assertEqual(recovery.listing(other,self.project)[0]['value'], values['value'])
            next_values={**values,'expected_revision':1,'value':{**values['value'],'body':'Next edit'}}
            second=recovery.save(other,**next_values)
            self.assertEqual(second, recovery.save(other,**next_values))
            with self.assertRaises(self.db.RevisionConflict): recovery.save(other,**{**next_values,'value':{**values['value'],'body':'Other device'}})
            hidden=recovery.save(other,**{**next_values,'expected_revision':2,'state':'discarded'})
            self.assertEqual(hidden['revision'],3)
            self.assertEqual(recovery.listing(other,self.project),[])
            self.assertIsNone(recovery.get(other,'foreign',first['id']))
            self.assertEqual(recovery.listing(other,'foreign'),[])
            self.assertEqual(other.execute('SELECT count(*) AS n FROM research.notebook_draft_revisions WHERE draft_id=%s',(first['id'],)).fetchone()['n'],3)

    def test_baseline_is_historical_and_target_cannot_move(self):
        from islam_research import notebook_drafts as recovery
        with self.db.connect(self.owner_dsn) as connection:
            saved=self.store.create(connection,**self.values)
            values={**self.payload(),'entry_id':saved['id'],'request_uuid':None,'record_id':self.source,
                    'document_id':self.document['id'],'annotation_id':self.annotation['id'],'base_revision':1}
            first=recovery.save(connection,**values)
            self.assertEqual(first['base_snapshot']['body'],self.values['body'])
            for change in [dict(base_revision=99),dict(project_id='foreign'),dict(record_id=None),dict(request_uuid=str(uuid.uuid4()))]:
                with self.assertRaises(ValueError): recovery.save(connection,**{**values,**change})
            self.assertEqual(self.store.get(connection,self.project,saved['id'])['body'],self.values['body'])

    def test_roles_cannot_retarget_rewrite_history_or_publish_recovery(self):
        from islam_research import notebook_drafts as recovery, publication
        from psycopg.errors import InsufficientPrivilege, CheckViolation
        import json
        with self.db.connect(self.owner_dsn) as connection:
            first=recovery.save(connection,**self.payload())
            for statement in ['DELETE FROM research.notebook_drafts', 'UPDATE research.notebook_drafts SET base_revision=2', "UPDATE research.notebook_draft_revisions SET snapshot='{}'"]:
                with self.assertRaises(InsufficientPrivilege):
                    with connection.transaction(): connection.execute(statement)
            with self.assertRaises(CheckViolation):
                with connection.transaction(): connection.execute('UPDATE research.notebook_drafts SET revision=revision+2 WHERE id=%s',(first['id'],))
            preview=publication.preview(connection,project_id=self.project,selections=[dict(record_id=self.source,include_summary=True,include_bibliography=True)],relation_ids=[],actor='owner')
            self.assertNotIn(first['id'],json.dumps(preview['payload'],default=str))
        with self.db.connect(self.publisher_dsn) as connection:
            for table in ['notebook_drafts','notebook_draft_revisions']:
                with self.assertRaises(InsufficientPrivilege):
                    with connection.transaction(): connection.execute('SELECT * FROM research.'+table)
