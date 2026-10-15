import unittest
import uuid

import test_api as boundary


class NotebookBoundaryTests(unittest.TestCase):
    setUp=boundary.APIBoundaryTests.setUp
    headers=boundary.APIBoundaryTests.headers

    def test_strict_owner_confirmation_actor_source_and_public_exclusion(self):
        class Store(boundary.MemoryBoundaryStore):
            def notebook_create(self,**value):return {**value,'id':'synthetic:entry','revision':1}
            def notebook_update(self,**value):return {**value,'id':value['entry_id'],'revision':value['expected_revision']+1}
            def notebook_items(self,**value):return []
        client=boundary.TestClient(boundary.create_app(self.settings,store=Store(),verifier=self.verifier))
        value=dict(request_uuid=str(uuid.uuid4()),project_id='synthetic:project',thought_type='question',title='Question',body='Private thought',links=[],owner_confirmed=True)
        response=client.post('/v1/notebook/entries',json=value,headers=self.headers());self.assertEqual(response.status_code,201,response.text)
        self.assertEqual(response.json()['actor'],boundary.OWNER)
        for patch in [dict(owner_confirmed=False),dict(actor='forged'),dict(review_state='reviewed'),dict(thought_type='consensus'),dict(links=[dict(kind='record',id='x',rationale='why',reviewed=True)])]:
            self.assertEqual(client.post('/v1/notebook/entries',json={**value,**patch},headers=self.headers()).status_code,422)
        self.assertEqual(client.post('/v1/notebook/entries',json=value).status_code,401)
        self.assertEqual(client.post('/v1/notebook/entries',json=value,headers=self.headers(sub='other')).status_code,403)
        self.assertEqual(client.post('/v1/notebook/entries',json=value,headers=self.headers(origin='https://other.example.invalid')).status_code,403)
        self.assertEqual(client.get('/v1/notebook/items',params=dict(project_id='synthetic:project'),headers=self.headers()).json(),dict(items=[],next_cursor=None))
        public=boundary.TestClient(boundary.create_app(boundary.Settings('synthetic',mode='public'),store=Store()))
        for path in ['/v1/notebook/items','/v1/notebook/entry','/v1/notebook/history']:
            self.assertEqual(public.get(path).status_code,404)
        self.assertEqual(public.post('/v1/notebook/entries',json=value).status_code,404)
