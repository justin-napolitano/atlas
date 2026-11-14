#!/usr/bin/env python3
"""Check the public Git index for accidental private data and credential material."""
import json
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[1]
PRIVATE_ROOTS = {'data', 'sources', 'notes', 'hypotheses', 'questions', 'reports',
                 'research-plans', 'research-library'}
PATTERNS = {
    'private key': re.compile(rb'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----'),
    'GitHub token': re.compile(rb'\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{50,})\b'),
    'AWS access key': re.compile(rb'\b(?:AKIA|ASIA)[A-Z0-9]{16}\b'),
    'workstation path': re.compile(rb'/Users/(?:JNA31A|justin)[^\s"\x27]*', re.I),
}


def main():
    paths = subprocess.check_output(['git', 'ls-files', '-z'], cwd=ROOT).decode().split('\0')
    errors = []
    checked = 0
    for name in filter(None, paths):
        path = Path(name)
        if path.parts[0] in PRIVATE_ROOTS or path.suffix in {'.xlsx', '.pdf', '.sqlite', '.sqlite3', '.db', '.dump', '.pem', '.key'} or path.name.startswith('.env'):
            errors.append(f'Private-data path: {name}')
        # Inspect staged bytes, including additions not yet committed.
        raw = subprocess.check_output(['git', 'show', ':'+name], cwd=ROOT)
        for label, pattern in PATTERNS.items():
            if pattern.search(raw):
                errors.append(f'{label}: {name}')
        checked += 1
    graph = (ROOT/'graph/research.ttl').read_text()
    if re.search(r'\s+a\s+ir:', graph):
        errors.append('Default graph must remain empty')
    for path in (ROOT/'src/islam_research/resources').glob('*'):
        if path.suffix == '.txt' or path.name in {'quran-pilot-v1.json', 'quran-reader-arabic-v1.json', 'quran-surah-names-v1.json', 'reading-collection-v1.json'}:
            errors.append('Removed bundled reader resource: '+path.name)
    if errors:
        raise SystemExit('\n'.join(errors))
    print(json.dumps({'checked_files': checked, 'private_data_findings': 0,
                      'default_graph': 'empty', 'bundled_reader_resources': 'absent'}))


if __name__ == '__main__':
    main()
