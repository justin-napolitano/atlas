"""Public artifact acceptance, hostile additions, and failure preservation."""
import copy
import json
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch

from islam_research import public_site as site, public_release as release
from test_public_release import ROOT, NOW, bundle


def seal(directory):
    manifest = json.loads((directory / "build-manifest.json").read_text())
    manifest.pop("build_id", None)
    manifest["files"] = {p.relative_to(directory).as_posix(): {"bytes": len(data), "sha256": release.digest(data)}
                         for p in sorted(directory.rglob("*")) if p.is_file() and p.name != "build-manifest.json"
                         for data in [p.read_bytes()]}
    manifest["build_id"] = "build-" + release.digest(release.encoded(manifest))
    (directory / "build-manifest.json").write_bytes(release.encoded(manifest))
    return manifest


def synthetic_site(root):
    directory = root / "artifact"; directory.mkdir()
    identifier, files = bundle()
    approved = release.write_bundle(root / "exports", identifier, files)
    shutil.copytree(approved, directory / "release")
    (directory / "site/assets").mkdir(parents=True)
    (directory / "site/index.html").write_text('<!doctype html><html lang="en"><head><script type="module" src="/assets/public-test.js"></script><link rel="stylesheet" href="/assets/public-test.css"></head><body><div id="root"></div></body></html>')
    (directory / "site/assets/public-test.js").write_text('export const synthetic = true;')
    (directory / "site/assets/public-test.css").write_text('body{color:black}')
    (directory / "site/.public-profile.json").write_bytes(release.encoded({"version": 1, "modules": sorted(site.policy(ROOT)["modules"])}))
    (directory / "runtime").mkdir()
    shutil.copyfile(ROOT / site.RUNTIME, directory / site.RUNTIME)
    manifest = {"format_version": 1, "kind": "approved_public_site", "built_at": NOW,
                "source_commit": "a" * 40, "source_inputs": site.source_inputs(ROOT), "release_id": identifier,
                "release_manifest_sha256": release.digest(files["release-manifest.json"]),
                "files": {}, "runtime": "node_http_read_only_v1", "deployed": False}
    (directory / "build-manifest.json").write_bytes(release.encoded(manifest))
    return directory, seal(directory)


class PublicSiteTests(unittest.TestCase):
    def test_independent_verifier_accepts_only_expected_site_and_selected_release(self):
        with tempfile.TemporaryDirectory() as temp:
            directory, manifest = synthetic_site(Path(temp))
            self.assertEqual(site.verify_site(directory, ROOT), manifest)
            self.assertFalse(manifest["deployed"])
            (directory / "site/assets/public-test.js").write_text("SYNTHETIC_TAMPERING")
            with self.assertRaises(ValueError): site.verify_site(directory, ROOT)

    def test_rehashed_owner_pages_private_release_files_and_arbitrary_runtime_are_rejected(self):
        for name, data in [("site/workspace.html", "SYNTHETIC_OWNER_PAGE"), ("site/assets/owner.js.map", "SYNTHETIC_SOURCE_MAP"),
                           ("release/private-notes.json", "SYNTHETIC_PRIVATE_NOTE"), (site.RUNTIME, "SYNTHETIC_REPLACEMENT_SERVER")]:
            with self.subTest(name=name), tempfile.TemporaryDirectory() as temp:
                directory, _ = synthetic_site(Path(temp))
                (directory / name).write_text(data); seal(directory)
                with self.assertRaises(ValueError): site.verify_site(directory, ROOT)

    def test_rehashed_inline_scripts_external_assets_event_handlers_and_refresh_are_rejected(self):
        for html in ['<script>alert(1)</script>', '<script src="https://example.invalid/code.js"></script>',
                     '<div onclick="alert(1)"></div>', '<iframe src="https://example.invalid/"></iframe>',
                     '<meta http-equiv="refresh" content="0; url=https://example.invalid">']:
            with self.subTest(html=html), tempfile.TemporaryDirectory() as temp:
                directory, _ = synthetic_site(Path(temp))
                path = directory / "site/index.html"
                path.write_text(path.read_text() + html); seal(directory)
                with self.assertRaises(ValueError): site.verify_site(directory, ROOT)

    def test_theme_is_externalized_for_a_script_policy_without_unsafe_inline(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); (root / "assets").mkdir()
            (root / "index.html").write_text('<script>document.documentElement.dataset.theme="dark";</script><script type="module" src="/assets/public-test.js"></script>')
            site._externalize_theme(root)
            self.assertNotIn('<script>document', (root / "index.html").read_text())
            theme = list((root / "assets").glob("theme-*.js"))
            self.assertEqual(len(theme), 1)
            self.assertEqual(theme[0].read_text(), 'document.documentElement.dataset.theme="dark";')

    def test_forged_frontend_profile_and_symlinks_are_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            directory, _ = synthetic_site(Path(temp))
            (directory / "site/.public-profile.json").write_text('{"version":1,"modules":["web/src/workspace.jsx"]}')
            seal(directory)
            with self.assertRaises(ValueError): site.verify_site(directory, ROOT)
        with tempfile.TemporaryDirectory() as temp:
            directory, _ = synthetic_site(Path(temp))
            path = directory / "site/assets/public-test.js"; path.unlink(); path.symlink_to(directory / "runtime/public-server.mjs")
            with self.assertRaises(ValueError): site.verify_site(directory, ROOT)

    def test_failed_compilation_preserves_current_build_pointer_and_cleans_staging(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); directory, manifest = synthetic_site(root)
            out = root / "build-output"; (out / "builds").mkdir(parents=True)
            retained = out / "builds" / manifest["build_id"]; shutil.copytree(directory, retained)
            pointer = release.encoded({"build_id": manifest["build_id"], "manifest_sha256": release.digest(release.encoded(manifest))})
            (out / "current.json").write_bytes(pointer)
            with patch.object(site, "source_commit", return_value="a" * 40), patch.object(site.subprocess, "run") as process:
                process.return_value.returncode = 1
                with self.assertRaises(ValueError): site.build_site(directory / "release", out, ROOT)
            self.assertEqual((out / "current.json").read_bytes(), pointer)
            self.assertEqual(site.current_site(out, ROOT)[1], manifest)
            self.assertFalse(list((out / "builds").glob(".staging-*")))

    def test_compiler_environment_excludes_runtime_credentials_and_node_injection(self):
        with patch.dict(site.os.environ, {"RESEARCH_PUBLISHER_DATABASE_URL": "SYNTHETIC_NOT_A_REAL_DSN",
                         "VITE_PRIVATE_TOKEN": "SYNTHETIC_TOKEN", "NODE_OPTIONS": "SYNTHETIC_INJECTION"}):
            env = site._environment()
        self.assertEqual(set(env), {"PATH", "NODE_ENV", "CI"})
        self.assertNotIn("SYNTHETIC", json.dumps(env))
