"""Owner transport contract; real PostgreSQL behavior is tested separately."""
import unittest

import test_api as boundary


@unittest.skipUnless(boundary.jwt, "Install API and test extras")
class ResearchSearchBoundaryTests(unittest.TestCase):
    setUp = boundary.APIBoundaryTests.setUp
    headers = boundary.APIBoundaryTests.headers

    def build_client(self):
        class Store(boundary.MemoryBoundaryStore):
            def research_search(self,project_id,query,limit):
                return dict(items=[],truncated=False,project_id=project_id,query=query,limit=limit)

            def reading_library(self,project_id,cursor,limit):
                return dict(items=[],next_cursor=None,project_id=project_id,cursor=cursor,limit=limit)

        return boundary.TestClient(boundary.create_app(self.settings,store=Store(),verifier=self.verifier))

    def test_owner_auth_bounds_and_public_route_absence(self):
        client=self.build_client()
        cases=[('/v1/research/search',dict(project_id='synthetic:project',q='authority',limit=50)),
               ('/v1/reading/library',dict(project_id='synthetic:project',cursor='synthetic:document',limit=50))]
        for path,params in cases:
            with self.subTest(path=path):
                self.assertEqual(client.get(path,params=params).status_code,401)
                self.assertEqual(client.get(path,params=params,headers=self.headers(sub='another-owner')).status_code,403)
                response=client.get(path,params=params,headers=self.headers())
                self.assertEqual(response.status_code,200,response.text)
                self.assertEqual(response.json()['project_id'],'synthetic:project')
                self.assertIn('no-store',response.headers['cache-control'])
                for patch in [dict(limit=0),dict(limit=51),dict(project_id='x'*501)]:
                    self.assertEqual(client.get(path,params={**params,**patch},headers=self.headers()).status_code,422)
                public=boundary.TestClient(boundary.create_app(boundary.Settings('synthetic',mode='public'),store=boundary.MemoryBoundaryStore()))
                self.assertEqual(public.get(path,params=params).status_code,404)
                self.assertNotIn(path,public.app.openapi()['paths'])

    def test_search_query_and_library_cursor_are_explicitly_bounded(self):
        client=self.build_client()
        for query in ['', '   ', 'x'*301]:
            response=client.get('/v1/research/search',params=dict(project_id='synthetic:project',q=query),headers=self.headers())
            self.assertEqual(response.status_code,422,response.text)
        self.assertEqual(client.get('/v1/reading/library',params=dict(project_id='synthetic:project',cursor='x'*501),headers=self.headers()).status_code,422)
        # A wildcard-shaped query is an ordinary literal, never SQL syntax.
        literal="%_' OR true --"
        response=client.get('/v1/research/search',params=dict(project_id='synthetic:project',q=literal),headers=self.headers())
        self.assertEqual(response.status_code,200,response.text)
        self.assertEqual(response.json()['query'],literal)
