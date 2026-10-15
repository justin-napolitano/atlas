"""Synthetic publication artifacts; no real research notes or cloud resources."""
import copy
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from islam_research import public_release as release
from islam_research.publication import project_payload
from test_publication import synthetic_inputs

ROOT = Path(__file__).resolve().parents[1]
NOW = "2026-10-15T00:00:00+00:00"


def row(project="synthetic", *, withdrawn=False):
    source = synthetic_inputs()
    source["project"]["id"] = project
    payload = project_payload(source, [{"record_id": "source:1", "include_bibliography": True}], [],
                              snapshot_id="publication-" + "a" * 32, generated_at=NOW)
    raw = json.dumps(payload, ensure_ascii=False)
    return {"project_id": project, "revision": 2 if withdrawn else 1,
            "status": "withdrawn" if withdrawn else "published",
            "snapshot_id": None if withdrawn else payload["snapshot_id"],
            "changed_at": NOW, "published_at": NOW,
            "payload_text": None if withdrawn else raw,
            "payload_sha256": release.digest(raw.encode())}


def bundle(rows=None, **kwargs):
    return release.make_bundle(rows if rows is not None else [row()], ROOT / "semantic", exported_at=NOW, **kwargs)


def reseal(files, *, heads=None):
    """An attacker can recompute hashes; strict content checks must still reject."""
    manifest = release.strict_json(files["release-manifest.json"])
    if heads is not None:
        manifest["heads"] = heads
    manifest.pop("release_id")
    manifest["files"] = {name: {"sha256": release.digest(data), "bytes": len(data)}
                         for name, data in files.items() if name != "release-manifest.json"}
    identifier = "release-" + release.digest(release.encoded(manifest))
    manifest["release_id"] = identifier
    files["release-manifest.json"] = release.encoded(manifest)
    return identifier


class PublicReleaseTests(unittest.TestCase):
    def test_browser_fixture_is_reproduced_by_the_actual_approved_bundle_exporter(self):
        fixture = json.loads((ROOT / "web/scripts/fixtures/approved-release.json").read_text())
        rows = []
        for project in fixture["/data/projects.json"]["projects"]:
            payload = fixture["/data/" + project["graph_data"]]
            raw = json.dumps(payload, ensure_ascii=False)
            rows.append({"project_id": project["id"], "revision": 1, "status": "published",
                         "snapshot_id": payload["snapshot_id"], "changed_at": NOW, "published_at": NOW,
                         "payload_text": raw, "payload_sha256": release.digest(raw.encode())})
        identifier, files = bundle(rows)
        self.assertEqual(fixture, {"/"+name: json.loads(data) for name,data in files.items() if name.startswith("data/")})
        with tempfile.TemporaryDirectory() as temp:
            release.verify_bundle(release.write_bundle(temp, identifier, files))

    def test_multi_project_roundtrip_preserves_source_limits_excludes_private_data(self):
        identifier, files = bundle([row("islam"), row("philosophy"), row("retired", withdrawn=True)])
        again = bundle([row("philosophy"), row("retired", withdrawn=True), row("islam")])
        self.assertEqual((identifier, files), again)
        text = b"".join(files.values()).decode()
        self.assertNotIn("PRIVATE_", text)
        self.assertNotIn("personal_states", text)
        self.assertNotIn("research.reading", text)
        self.assertIn("Abstract only; full argument not verified", text)
        with tempfile.TemporaryDirectory() as temp:
            directory = release.write_bundle(temp, identifier, files)
            current, manifest = release.current_bundle(temp)
            self.assertEqual(current, directory)
            self.assertEqual(manifest["release_id"], identifier)
            self.assertEqual(len([p for p in files if p.startswith("data/graph-")]), 2)
            self.assertEqual(release.write_bundle(temp, identifier, files), directory)
            result = subprocess.run([sys.executable, "scripts/export_approved_release.py", "current", "--path", temp],
                                    cwd=ROOT, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(json.loads(result.stdout)["projects"], 2)
            self.assertFalse(json.loads(result.stdout)["deployed"])

    def test_withdrawal_exports_empty_index_without_old_graph_or_title(self):
        identifier, files = bundle([row(withdrawn=True)])
        self.assertFalse(any(p.startswith("data/graph-") for p in files))
        self.assertEqual(release.strict_json(files["data/projects.json"])["projects"], [])
        self.assertNotIn("Synthetic source", b"".join(files.values()).decode())
        with tempfile.TemporaryDirectory() as temp:
            first, active = bundle()
            release.write_bundle(temp, first, active)
            release.write_bundle(temp, identifier, files)
            directory, _ = release.current_bundle(temp)
            self.assertEqual(directory.name, identifier)
            self.assertTrue((directory.parent / first).is_dir())  # Retained archive, not current content.

    def test_invalid_capture_never_replaces_last_good_pointer(self):
        with tempfile.TemporaryDirectory() as temp:
            identifier, files = bundle()
            release.write_bundle(temp, identifier, files)
            pointer = (Path(temp) / "current.json").read_bytes()
            bad = copy.deepcopy(files)
            bad["data/projects.json"] = b'{}'
            forged = reseal(bad)
            with self.assertRaises(ValueError):
                release.write_bundle(temp, forged, bad)
            self.assertEqual((Path(temp) / "current.json").read_bytes(), pointer)
            self.assertEqual(release.current_bundle(temp)[1]["release_id"], identifier)
            self.assertFalse(list((Path(temp) / "releases").glob(".staging-*")))

    def test_io_failure_before_pointer_activation_preserves_current(self):
        with tempfile.TemporaryDirectory() as temp:
            identifier, files = bundle()
            release.write_bundle(temp, identifier, files)
            pointer = (Path(temp) / "current.json").read_bytes()
            new, withdrawn = bundle([row(withdrawn=True)])
            with patch.object(release.os, "replace", side_effect=OSError("SYNTHETIC_IO_ERROR")):
                with self.assertRaises(OSError):
                    release.write_bundle(temp, new, withdrawn)
            self.assertEqual((Path(temp) / "current.json").read_bytes(), pointer)

    def test_capture_refuses_missing_duplicate_digest_invalid_and_private_fields(self):
        invalid = [[], [row(), row()], [{**row(), "payload_sha256": "0" * 64}],
                   [{**row(), "payload_text": None}], [{**row(withdrawn=True), "snapshot_id": "old"}]]
        for rows in invalid:
            with self.subTest(rows=len(rows)), self.assertRaises(ValueError):
                bundle(rows)
        for mutate in (
            lambda p: p.update(private_note="SYNTHETIC_PRIVATE"),
            lambda p: p["nodes"][0].update(personal_note="SYNTHETIC_PRIVATE"),
            lambda p: p["nodes"][0].update(type="note"),
            lambda p: p["nodes"][0].update(source_revision=True),
            lambda p: p.update(project={"id": "wrong", "title": "Wrong project"}),
            lambda p: p["nodes"][0].update(links=[{"url": "https://example.invalid/?token=SYNTHETIC", "label": "source"}]),
            lambda p: p["nodes"].append(copy.deepcopy(p["nodes"][0])),
        ):
            source = row()
            payload = json.loads(source["payload_text"])
            mutate(payload)
            source["payload_text"] = json.dumps(payload)
            source["payload_sha256"] = release.digest(source["payload_text"].encode())
            with self.assertRaises(ValueError):
                bundle([source])

    def test_rehashed_private_semantics_unselected_graph_and_metadata_are_rejected(self):
        _, original = bundle()
        mutations = (
            lambda f: f.update({"semantic/publication.ossie.json": release.encoded({"private": "SYNTHETIC_PRIVATE"})}),
            lambda f: f.update({"data/graph-" + "0" * 64 + ".json": next(v for k,v in f.items() if k.startswith("data/graph-"))}),
            lambda f: f.update({"data/private-notes.json": b'{}'}),
            lambda f: f.update({"semantic/vendor/apache-ossie/NOTICE": b"forged"}),
            lambda f: f.update({"data/release.json": b'{"deployed":true}'}),
        )
        for mutate in mutations:
            files = copy.deepcopy(original)
            mutate(files)
            identifier = reseal(files)
            with tempfile.TemporaryDirectory() as temp, self.assertRaises(ValueError):
                release.write_bundle(temp, identifier, files)

    def test_tamper_unexpected_file_and_symlink_rejected(self):
        for mode in ("tamper", "extra", "symlink"):
            with tempfile.TemporaryDirectory() as temp:
                identifier, files = bundle()
                directory = release.write_bundle(temp, identifier, files)
                target = directory / "data/projects.json"
                if mode == "tamper":
                    target.write_bytes(b'{}')
                elif mode == "extra":
                    (directory / "unexpected").write_bytes(b"synthetic")
                else:
                    target.unlink()
                    target.symlink_to(directory / "data/release.json")
                with self.assertRaises(ValueError):
                    release.current_bundle(temp)

    def test_json_limits_duplicate_keys_and_nonfinite_numbers_rejected(self):
        for value in (b'{"x":1,"x":2}', b'{"x":NaN}', b'\xff', b'[' * 10000):
            with self.assertRaises(ValueError):
                release.strict_json(value)
        with self.assertRaises(ValueError):
            release.strict_json(b"123", limit=2)

    def test_private_workspace_model_is_never_loaded_and_upstream_drift_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            import shutil
            shutil.copytree(ROOT / "semantic", root / "semantic")
            (root / "semantic/research.ossie.json").write_text("INVALID_PRIVATE_MODEL")
            self.assertEqual(release.semantics_files(root / "semantic"), release.semantics_files(ROOT / "semantic"))
            (root / "semantic/vendor/apache-ossie/NOTICE").write_text("SYNTHETIC_DRIFT")
            with self.assertRaises(ValueError):
                release.semantics_files(root / "semantic")

    def test_cli_errors_redact_database_url_paths_and_payloads(self):
        env = dict(os.environ, RESEARCH_PUBLISHER_DATABASE_URL="postgresql://SYNTHETIC_SECRET@127.0.0.1:1/none")
        result = subprocess.run([sys.executable, "scripts/export_approved_release.py", "export"],
                                cwd=ROOT, env=env, capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn("SYNTHETIC_SECRET", result.stdout + result.stderr)
        self.assertNotIn("Traceback", result.stderr)
        self.assertNotIn(str(ROOT), result.stderr)
