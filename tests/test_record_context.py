"""Real database evidence for owner graph neighborhood boundaries."""
import os
import unittest
import uuid


@unittest.skipUnless(os.environ.get("RESEARCH_TEST_DATABASE_URL"),"Requires real isolated PostgreSQL")
class RecordContextTests(unittest.TestCase):
    def test_directions_paging_tombstones_and_project_scope(self):
        from islam_research import database as db
        from islam_research.api_store import PostgreSQLStore
        from psycopg.types.json import Jsonb
        dsn=os.environ['RESEARCH_TEST_DATABASE_URL'];prefix='test:'+uuid.uuid4().hex+':';project=prefix+'p'
        with db.connect(dsn) as connection:
            db.migrate(connection);db.create_project(connection,project,'Synthetic graph context')
            for key,kind in [('s','source'),('c','claim'),('e','evidence')]:db.save_record(connection,record_id=prefix+key,project_id=project,kind=kind,title='Synthetic '+key,actor='test-owner')
            predicate='https://islam-research.local/vocab/source'
            connection.execute("INSERT INTO research.relation_types(predicate,description) VALUES(%s,'Synthetic') ON CONFLICT DO NOTHING",(predicate,))
            for index,origin,target in [('1','s','e'),('2','c','s')]:connection.execute('INSERT INTO research.relations(id,project_id,from_id,to_id,predicate,provenance) VALUES(%s,%s,%s,%s,%s,%s)',(prefix+index,project,prefix+origin,prefix+target,predicate,Jsonb({'basis':'Synthetic fixture, not inferred support'})))
        store=PostgreSQLStore(dsn);value=store.record_context(project,prefix+'s','',1)
        self.assertEqual(value['items'][0]['direction'],'out');self.assertEqual(value['items'][0]['node']['id'],prefix+'e')
        second=store.record_context(project,prefix+'s',value['next_cursor'],1)
        self.assertEqual(second['items'][0]['direction'],'in');self.assertIsNone(second['next_cursor'])
        self.assertIsNone(store.record_context('other',prefix+'s','',25))
        with db.connect(dsn) as connection:connection.execute('UPDATE research.records SET deleted_at=clock_timestamp(),revision=revision+1 WHERE id=%s',(prefix+'e',))
        self.assertEqual(len(store.record_context(project,prefix+'s','',25)['items']),1)


class ContextBoundaryTests(unittest.TestCase):
    def test_signed_owner_and_public_exclusion(self):
        try:
            import test_api as fixtures
            if fixtures.jwt is None:self.skipTest('Requires API extras')
        except ImportError:self.skipTest('Requires API extras')
        boundary=fixtures.APIBoundaryTests();boundary.setUp()
        class Store(fixtures.MemoryBoundaryStore):
            def record_context(self,project_id,record_id,cursor,limit):
                return {'project_id':project_id,'record':{'id':record_id},'items':[]}
            def link_collection_reading(self,**values):
                return {'project_id':values['project_id'],'actor':values['actor']}
        client=fixtures.TestClient(fixtures.create_app(boundary.settings,store=Store(),verifier=boundary.verifier))
        url='/v1/record-context?project_id=synthetic&record_id=synthetic:source'
        self.assertEqual(client.get(url).status_code,401)
        self.assertEqual(client.get(url,headers=boundary.headers(sub='other')).status_code,403)
        self.assertEqual(client.get(url,headers=boundary.headers()).status_code,200)
        self.assertEqual(client.get(url+'&limit=26',headers=boundary.headers()).status_code,422)
        self.assertEqual(client.get('/v1/reading/collection').status_code,401)
        collection=client.get('/v1/reading/collection',headers=boundary.headers()).json()
        self.assertEqual(len(collection['readings']),5)
        payload=dict(project_id='synthetic',reading_id='rodwell-4-59',document_id='synthetic:doc',request_uuid=str(uuid.uuid4()),rationale='Explicit located reading',owner_confirmed=True)
        self.assertEqual(client.post('/v1/reading/link-collection',json=payload).status_code,401)
        self.assertEqual(client.post('/v1/reading/link-collection',json={**payload,'owner_confirmed':False},headers=boundary.headers()).status_code,422)
        self.assertEqual(client.post('/v1/reading/link-collection',json=payload,headers=boundary.headers()).json()['actor'],fixtures.OWNER)
        public=fixtures.create_app(fixtures.Settings('synthetic-not-a-live-dsn',mode='public'),store=Store())
        self.assertNotIn('/v1/record-context',{route.path for route in public.routes})
        self.assertNotIn('/v1/reading/collection',{route.path for route in public.routes})
        self.assertNotIn('/v1/reading/link-collection',{route.path for route in public.routes})
