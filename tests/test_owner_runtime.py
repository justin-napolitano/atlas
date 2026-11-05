import hashlib
import json
from pathlib import Path
import tempfile
import time
import unittest

import jwt
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi.testclient import TestClient
from islam_research.api import Settings
from islam_research.api_auth import IAPVerifier, IAP_ISSUER
from islam_research.owner_runtime import create_owner_app, load_frontend


class Store:
    def ready(self, mode): return True
    def projects(self): return [{'id': 'synthetic'}]


class OwnerRuntimeTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.files = {'workspace.html': b'<html>Owner workspace</html>', 'publish.html': b'<html>Owner publication</html>', 'assets/owner-abc.js': b'/* synthetic */'}
        for name, value in self.files.items():
            target = self.root / name; target.parent.mkdir(exist_ok=True); target.write_bytes(value)
        self.manifest = {'format_version': 1, 'kind': 'private_owner_frontend', 'source_commit': 'a' * 40,
                         'files': {name: {'bytes': len(value), 'sha256': hashlib.sha256(value).hexdigest()} for name, value in self.files.items()}}
        self.write_manifest()
        self.key = ec.generate_private_key(ec.SECP256R1())
        self.settings = Settings('synthetic', owner_subject='synthetic-owner', iap_audience='/projects/123/locations/us-central1/services/owner', owner_origin='https://owner.example.invalid')
        self.verifier = IAPVerifier(self.settings.iap_audience, self.settings.owner_subject, loader=lambda: {'synthetic': self.key.public_key()})
        self.client = TestClient(create_owner_app(self.settings, store=Store(), verifier=self.verifier, directory=self.root))

    def tearDown(self): self.tmp.cleanup()
    def write_manifest(self): (self.root / 'owner-manifest.json').write_text(json.dumps(self.manifest))
    def headers(self, subject='synthetic-owner'):
        now = int(time.time())
        token = jwt.encode({'iss': IAP_ISSUER, 'aud': self.settings.iap_audience, 'sub': subject, 'iat': now, 'exp': now + 600}, self.key, algorithm='ES256', headers={'kid': 'synthetic'})
        return {'x-goog-iap-jwt-assertion': token}

    def test_every_page_and_asset_requires_signed_owner(self):
        for path in ['/', '/workspace.html', '/publish.html', '/assets/owner-abc.js', '/owner-manifest.json', '/unknown']:
            self.assertEqual(self.client.get(path).status_code, 401)
            self.assertEqual(self.client.get(path, headers={'x-goog-authenticated-user-email': 'synthetic-owner@example.invalid'}).status_code, 401)
            self.assertEqual(self.client.get(path, headers=self.headers('another-owner')).status_code, 403)
        self.assertEqual(self.client.get('/', headers=self.headers(), follow_redirects=False).headers['location'], '/workspace.html')
        for path in self.files:
            result = self.client.get('/' + path, headers=self.headers())
            self.assertEqual(result.content, self.files[path])
            self.assertEqual(result.headers['cache-control'], 'no-store')
            self.assertEqual(result.headers['x-robots-tag'], 'noindex, nofollow')
            self.assertIn("script-src 'self'", result.headers['content-security-policy'])
            self.assertEqual(len(result.headers.get_list('content-security-policy')), 1)
            head = self.client.head('/' + path, headers=self.headers())
            self.assertEqual(head.content, b'')
            self.assertEqual(int(head.headers['content-length']), len(self.files[path]))

    def test_api_dispatch_auth_csrf_and_health_are_preserved(self):
        self.assertEqual(self.client.get('/health/live').status_code, 200)
        self.assertEqual(self.client.get('/health/ready').status_code, 200)
        self.assertEqual(self.client.get('/v1/projects').status_code, 401)
        response = self.client.get('/v1/projects', headers=self.headers())
        self.assertEqual(response.json()['items'][0]['id'], 'synthetic')
        self.assertEqual(response.headers['content-security-policy'], "default-src 'none'; frame-ancestors 'none'")
        self.assertEqual(self.client.post('/v1/projects', json={'project_id': 'x', 'title': 'x'}, headers=self.headers()).status_code, 403)
        for path in ['/v1/unknown', '/v1/public/snapshots/example', '/health/unknown', '/src/workspace.jsx', '/data/public-graph.json', '/owner-manifest.json', '/assets/../owner-manifest.json']:
            self.assertEqual(self.client.get(path, headers=self.headers()).status_code, 404)
        self.assertEqual(self.client.post('/workspace.html', headers=self.headers()).status_code, 405)

    def test_runtime_preloads_verified_bytes_and_refuses_public_mode(self):
        (self.root / 'workspace.html').write_bytes(b'changed after startup')
        self.assertEqual(self.client.get('/workspace.html', headers=self.headers()).content, self.files['workspace.html'])
        with self.assertRaises(ValueError): load_frontend(self.root)
        with self.assertRaises(ValueError): create_owner_app(Settings('synthetic', mode='public'), store=Store(), directory=self.root)

    def test_extra_symlink_or_unsafe_manifest_files_fail_before_serving(self):
        for name in ['data.json', '.env', 'assets/owner.js.map']:
            path = self.root / name; path.write_bytes(b'never serve')
            with self.assertRaises(ValueError): load_frontend(self.root)
            path.unlink()
        (self.root / 'assets/link.js').symlink_to(self.root / 'workspace.html')
        with self.assertRaises(ValueError): load_frontend(self.root)
        (self.root / 'assets/link.js').unlink()
        self.manifest['files']['../escape.js'] = {'bytes': 0, 'sha256': 'a' * 64}; self.write_manifest()
        with self.assertRaises(ValueError): load_frontend(self.root)
