#!/usr/bin/env python3
"""Run a long, paced seed-plan harvest and refresh only the public static snapshot."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import subprocess
import sys
import time
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from islam_research import cli


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--plan", type=Path, default=ROOT / "research-plans/background-question-seeds.json")
    parser.add_argument("--resume", help="resume a prior run ID")
    parser.add_argument("--max-hours", type=float, default=4)
    parser.add_argument("--min-interval", type=float, default=60)
    args = parser.parse_args()
    plan_path = args.plan.expanduser().resolve()
    plan = cli.read_json(plan_path)
    before = {path.resolve() for path in (cli.LIBRARY / "searches").glob("*/run.json")}
    started = time.time()
    run_args = SimpleNamespace(plan=plan_path, resume=args.resume, max_hours=args.max_hours, min_interval=args.min_interval)
    search_status = cli.run_plan(run_args)

    if args.resume:
        run_id = args.resume
    else:
        runs = []
        for path in (cli.LIBRARY / "searches").glob("*/run.json"):
            if path.resolve() in before:
                continue
            try:
                manifest = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                continue
            if manifest.get("plan_id") == plan.get("id", plan_path.stem) and path.stat().st_mtime >= started:
                runs.append((path.stat().st_mtime, manifest.get("run_id")))
        if not runs:
            parser.error("search plan did not produce a run manifest")
        run_id = max(runs)[1]

    manifest_path = cli.LIBRARY / "searches" / run_id / "run.json"
    manifest = cli.read_json(manifest_path)
    responded = sum(
        row.get("status") == "complete"
        or ("No results were retrieved" in str(row.get("stderr") or "")
            and not any(marker in str(row.get("stderr") or "") for marker in ("HTTP ", "Source returned", "Could not reach")))
        for row in manifest.get("queries", [])
    )
    if not responded:
        print(f"::warning::No provider returned a valid response; publishing health status while retaining the last public lead index.", file=sys.stderr)

    cli.candidates(SimpleNamespace(run_id=run_id, limit=0))
    export = subprocess.run([
        sys.executable, str(ROOT / "web/scripts/export_public_graph.py"),
        "--run-id", run_id,
    ], text=True)
    if export.returncode:
        return export.returncode
    print(f"Nightly harvest {run_id}: {responded}/{len(manifest.get('queries', []))} provider queries returned a valid response; run status={manifest.get('status')}; public leads remain unreviewed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
