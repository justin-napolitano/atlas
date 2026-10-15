#!/usr/bin/env python3
"""Build the owner UI without public data, source maps, or private runtime config."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'src'))
from islam_research.owner_runtime import load_frontend


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    output = args.output.resolve()
    if output.exists(): raise ValueError('Choose a new owner artifact directory')
    source = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    subprocess.run(['npm', 'exec', '--', 'vite', 'build', '--config', 'owner.vite.config.js', '--outDir', str(output)], cwd=ROOT / 'web', check=True)
    files = {p.relative_to(output).as_posix(): {'bytes': p.stat().st_size, 'sha256': hashlib.sha256(p.read_bytes()).hexdigest()}
             for p in sorted(output.rglob('*')) if p.is_file()}
    (output / 'owner-manifest.json').write_text(json.dumps({'format_version': 1, 'kind': 'private_owner_frontend', 'source_commit': source, 'files': files}, sort_keys=True, indent=2) + '\n')
    load_frontend(output)
    print(json.dumps({'kind': 'private_owner_frontend', 'source_commit': source, 'files': len(files), 'deployed': False}))


if __name__ == '__main__': main()
