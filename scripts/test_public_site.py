#!/usr/bin/env python3
"""Full synthetic export -> compiler -> verifier -> HTTP/browser checks, no database."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import uuid
from contextlib import contextmanager

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from islam_research import public_release as release, public_site as site


@contextmanager
def synthetic_main_change(extra):
    path = ROOT / "web/src/main.jsx"
    original = path.read_bytes(); changed = original + extra.encode()
    path.write_bytes(changed)
    try:
        yield
    finally:
        if path.read_bytes() != changed:
            raise RuntimeError("Source changed concurrently; retain it for inspection")
        path.write_bytes(original)


def compiler_boundaries(root, output):
    marker = "SYNTHETIC_DO_NOT_PUBLISH_" + uuid.uuid4().hex
    bait = ROOT / "web/public" / ("synthetic-build-bait-" + uuid.uuid4().hex + ".txt")
    env_file = ROOT / "web/.env.production.local"
    if env_file.exists():
        raise RuntimeError("Run compiler boundary tests in an isolated checkout without a preexisting environment file")
    try:
        with bait.open("x") as handle: handle.write(marker)
        with env_file.open("x") as handle: handle.write("VITE_SYNTHETIC_PRIVATE=" + marker + "\n")
        with synthetic_main_change("\nconsole.log(import.meta.env);\n"):
            probe = root / "environment-probe"
            result = subprocess.run(["node", "web/scripts/build-public-frontend.mjs", str(probe)], cwd=ROOT,
                env={**site._environment(), "VITE_SYNTHETIC_PRIVATE": marker}, capture_output=True, timeout=60)
            assert result.returncode == 0
            assert not any(marker.encode() in p.read_bytes() for p in probe.rglob("*") if p.is_file())
            assert not (probe / bait.name).exists()
        pointer = (output / "current.json").read_bytes()
        with synthetic_main_change("\nimport './workspace.jsx';\n"):
            result = subprocess.run(["node", "web/scripts/build-public-frontend.mjs", str(root / "owner-import-probe")],
                cwd=ROOT, env=site._environment(), capture_output=True, timeout=60)
            assert result.returncode != 0
        assert (output / "current.json").read_bytes() == pointer
    finally:
        bait.unlink(missing_ok=True)
        # Never remove an environment file another process changed during the probe.
        if env_file.exists() and env_file.read_text() == "VITE_SYNTHETIC_PRIVATE=" + marker + "\n":
            env_file.unlink()


def fixture(root):
    data = json.loads((ROOT / "web/scripts/fixtures/approved-release.json").read_text())
    now = data["/data/release.json"]["exported_at"]
    rows = []
    for project in data["/data/projects.json"]["projects"]:
        payload = data["/data/" + project["graph_data"]]
        raw = json.dumps(payload, ensure_ascii=False)
        rows.append(dict(project_id=project["id"], revision=1, status="published", snapshot_id=payload["snapshot_id"],
                         changed_at=now, published_at=now, payload_text=raw, payload_sha256=release.digest(raw.encode())))
    identifier, files = release.make_bundle(rows, ROOT / "semantic", exported_at=now)
    return release.write_bundle(root / "exports", identifier, files)


def run():
    notices = (ROOT / "web/THIRD_PARTY_LICENSES.txt").read_text()
    for package in site.policy(ROOT)["dependency_packages"]:
        installed = ROOT / "web/node_modules" / package
        version = json.loads((installed / "package.json").read_text())["version"]
        assert package + " " + version in notices
        assert (installed / "LICENSE").read_text() in notices
    with tempfile.TemporaryDirectory(prefix="research-public-site-") as temporary:
        root = Path(temporary)
        approved = fixture(root)
        output = root / "public-sites"
        directory, manifest = site.build_site(approved, output, ROOT)
        assert site.current_site(output, ROOT)[1] == manifest
        assert site.verify_site(directory, ROOT) == manifest
        assert not any(name.endswith(("workspace.html", "publish.html", "public-graph.json", ".map")) for name in manifest["files"])
        compiler_boundaries(root, output)
        env = {**site._environment(), "RESEARCH_TEST_PUBLIC_SITE": str(directory)}
        if "CHROME_PATH" in os.environ: env["CHROME_PATH"] = os.environ["CHROME_PATH"]
        subprocess.run(["node", "--test", "runtime/public-server.test.mjs"], cwd=ROOT, env=env, check=True, timeout=60)
        subprocess.run(["node", "web/scripts/review-public-site.mjs"], cwd=ROOT, env=env, check=True, timeout=90)
        print(json.dumps({"public_site_pipeline_passed": True, "deployed": False,
                          "build_id": manifest["build_id"], "release_id": manifest["release_id"]}))


if __name__ == "__main__":
    try:
        run()
    except Exception:
        print("Synthetic public site validation failed; no deployment was attempted.", file=sys.stderr)
        raise SystemExit(1)
