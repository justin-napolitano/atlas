#!/usr/bin/env python3
"""Full synthetic export -> compiler -> verifier -> HTTP/browser checks, no database."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from islam_research import public_release as release, public_site as site


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
    with tempfile.TemporaryDirectory(prefix="research-public-site-") as temporary:
        root = Path(temporary)
        approved = fixture(root)
        output = root / "public-sites"
        directory, manifest = site.build_site(approved, output, ROOT)
        assert site.current_site(output, ROOT)[1] == manifest
        assert site.verify_site(directory, ROOT) == manifest
        assert not any(name.endswith(("workspace.html", "publish.html", "public-graph.json", ".map")) for name in manifest["files"])
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
