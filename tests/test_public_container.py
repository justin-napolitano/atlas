"""Context boundary tests use no Docker, scanner download or cloud account."""
import json
from pathlib import Path
import tempfile
import unittest

from islam_research import public_container as container, public_release as release
from test_public_site import ROOT, synthetic_site


def reseal(path):
    value = json.loads((path / "container-context.json").read_text())
    value.pop("context_id")
    value["files"] = {p.relative_to(path).as_posix(): {"bytes": len(data), "sha256": release.digest(data)}
                      for p in sorted(path.rglob("*")) if p.is_file() and p.name != "container-context.json"
                      for data in [p.read_bytes()]}
    value["context_id"] = "context-" + release.digest(release.encoded(value))
    (path / "container-context.json").write_bytes(release.encoded(value))


class PublicContainerTests(unittest.TestCase):
    def test_bundled_frontend_inventory_has_locked_purls_integrity_and_licenses(self):
        bom = container.frontend_bom(ROOT)
        self.assertEqual(bom["bomFormat"], "CycloneDX")
        self.assertEqual({row["name"] for row in bom["components"]}, {"react", "react-dom", "scheduler"})
        for row in bom["components"]:
            self.assertEqual(row["purl"], "pkg:npm/" + row["name"] + "@" + row["version"])
            self.assertEqual(len(row["hashes"][0]["content"]), 128)
            self.assertEqual(row["licenses"][0]["license"]["id"], "MIT")

    def test_context_contains_only_verified_artifact_and_fixed_container_instructions(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); artifact, build = synthetic_site(root)
            path, metadata = container.prepare_context(artifact, root / "contexts", ROOT)
            self.assertEqual(container.verify_context(path, ROOT), metadata)
            self.assertFalse(metadata["deployed"])
            self.assertIn(b"USER 1000:1000", (path / "Dockerfile").read_bytes())
            self.assertIn(b"@sha256:", (path / "Dockerfile").read_bytes())
            self.assertEqual((path / ".dockerignore").read_bytes(), container.DOCKERIGNORE)
            self.assertEqual((path / "artifact/build-manifest.json").read_bytes(), release.encoded(build))
            self.assertEqual(container.prepare_context(artifact, root / "contexts", ROOT)[0], path)
            self.assertFalse(list((root / "contexts").glob(".staging-*")))

    def test_unregistered_files_and_forged_container_instructions_are_rejected_after_rehash(self):
        for kind in ("extra", "dockerfile", "ignore"):
            with tempfile.TemporaryDirectory() as temp:
                root = Path(temp); artifact, _ = synthetic_site(root)
                path, _ = container.prepare_context(artifact, root / "contexts", ROOT)
                target = path / {"extra": "private.env", "dockerfile": "Dockerfile", "ignore": ".dockerignore"}[kind]
                target.write_text("SYNTHETIC_UNAPPROVED_INPUT")
                reseal(path)
                with self.assertRaises(ValueError): container.verify_context(path, ROOT)

    def test_runtime_permissions_cannot_be_changed_to_writable_in_verified_context(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); artifact, _ = synthetic_site(root)
            path, _ = container.prepare_context(artifact, root / "contexts", ROOT)
            (path / "artifact/site/index.html").chmod(0o644)
            with self.assertRaises(ValueError): container.verify_context(path, ROOT)

    def test_output_cannot_modify_its_verified_input(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); artifact, _ = synthetic_site(root)
            before = (artifact / "build-manifest.json").read_bytes()
            with self.assertRaises(ValueError): container.prepare_context(artifact, artifact / "contexts", ROOT)
            self.assertEqual((artifact / "build-manifest.json").read_bytes(), before)

    def test_docker_execution_guard_refuses_this_machine_before_any_tool_call(self):
        import subprocess
        import sys
        result = subprocess.run([sys.executable, "scripts/check_public_container.py"], cwd=ROOT,
                                env={"PATH": "/nonexistent"}, capture_output=True, text=True, timeout=10)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('"container_phase": "guard"', result.stderr)

