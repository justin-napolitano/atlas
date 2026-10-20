import unittest
from unittest.mock import patch
import test_api as base
from test_api import MemoryBoundaryStore,jwt

@unittest.skipUnless(jwt,'Install api/test extras')
class WorkspaceHTTPTests(unittest.TestCase):
    setUp=base.APIBoundaryTests.setUp
    headers=base.APIBoundaryTests.headers
    def test_project_free_owner_capture_rejects_ownership_fields_and_csrf_bypass(self):
        value=dict(request_uuid='59e908ae-0344-4918-997d-26c963741a74',body='A loose thought.',owner_confirmed=True)
        self.assertEqual(self.client.post('/v1/workspace/notes',json=value).status_code,401)
        with patch.object(MemoryBoundaryStore,'workspace_operation',return_value={'id':'synthetic:note','project_id':None},create=True) as call:
            self.assertEqual(self.client.post('/v1/workspace/notes',json=value,headers=self.headers()).status_code,201)
            self.assertNotIn('project_id',call.call_args.kwargs)
            self.assertEqual(call.call_args.kwargs['actor'],base.OWNER)
            for patch_value in [{'project_id':'hidden-project'},{'workspace_id':'another'},{'owner_confirmed':1},{'body':''}]:
                self.assertEqual(self.client.post('/v1/workspace/notes',json={**value,**patch_value},headers=self.headers()).status_code,422)
        missing=self.headers();missing.pop('x-research-write')
        self.assertEqual(self.client.post('/v1/workspace/notes',json=value,headers=missing).status_code,403)
    def test_global_queries_are_owner_only_and_bounded(self):
        self.assertEqual(self.client.get('/v1/workspace/notes').status_code,401)
        with patch.object(MemoryBoundaryStore,'workspace_operation',return_value={'items':[],'next_cursor':None},create=True) as call:
            self.assertEqual(self.client.get('/v1/workspace/notes?q=idea&thought_type=question',headers=self.headers()).status_code,200)
            self.assertEqual(call.call_args.kwargs['q'],'idea')
        for q in ['limit=51','q='+'x'*301,'thought_type=reviewed']:
            self.assertEqual(self.client.get('/v1/workspace/notes?'+q,headers=self.headers()).status_code,422)
    def test_anonymous_runtime_has_no_workspace_routes_or_schema(self):
        from fastapi.testclient import TestClient
        from islam_research.api import create_app,Settings
        app=create_app(Settings('synthetic',mode='public'),store=MemoryBoundaryStore())
        with TestClient(app) as client:
            for path in ['/v1/workspace/notes','/v1/workspace/note?entry_id=synthetic','/v1/workspace/drafts']:
                self.assertEqual(client.get(path).status_code,404)
        self.assertFalse(any('/workspace/' in path for path in app.openapi()['paths']))
