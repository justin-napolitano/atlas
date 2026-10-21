#!/usr/bin/env python3
"""Build a frozen owner API and offline resources; never copy owner state."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys

ROOT=Path(__file__).resolve().parents[1]


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--postgres',type=Path,required=True,help='Verified PostgreSQL 17 distribution (bin/lib/share)')
    args=parser.parse_args();postgres=args.postgres.resolve()
    for item in ['bin/postgres','bin/initdb','bin/pg_ctl','bin/pg_dump','bin/pg_restore','share/postgresql/postgres.bki']:
        if not (postgres/item).is_file():raise ValueError('Incomplete PostgreSQL distribution')
    version=subprocess.check_output([str(postgres/'bin/postgres'),'--version'],text=True).strip()
    if not version.startswith('postgres (PostgreSQL) 17.'):raise ValueError('Expected PostgreSQL major 17')
    output=ROOT/'research-library/desktop-resources'
    if output.exists():shutil.rmtree(output)
    output.mkdir(parents=True)
    subprocess.run([sys.executable,str(ROOT/'scripts/build_owner_frontend.py'),'--output',str(output/'frontend')],cwd=ROOT,check=True)
    # Local-storage disclosure is shared with the configured browser build.
    manifest=json.loads((output/'frontend/owner-manifest.json').read_text())
    for name in ['workspace.html','publish.html']:
        target=output/'frontend'/name
        target.write_text(target.read_text().replace('<head>','<head><meta name="research-storage-mode" content="local-postgres">',1))
        data=target.read_bytes();manifest['files'][name]={'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()}
    (output/'frontend/owner-manifest.json').write_text(json.dumps(manifest))
    for name in ['bin','lib','share']:
        shutil.copytree(postgres/name,output/'postgres'/name,symlinks=True)
    work=ROOT/'research-library/desktop-freeze'
    subprocess.run([sys.executable,'-m','PyInstaller','--noconfirm','--onedir','--name','atlas-service',
        '--distpath',str(output/'runtime'),'--workpath',str(work/'work'),'--specpath',str(work),
        '--paths',str(ROOT/'src'),'--collect-data','islam_research','--collect-submodules','uvicorn',
        '--collect-submodules','rdflib','--collect-submodules','psycopg_binary',
        str(ROOT/'scripts/desktop_service.py')],cwd=ROOT,check=True)
    (output/'build.json').write_text(json.dumps({'format':1,'kind':'offline-local-postgresql',
        'postgres':version,'python':sys.version.split()[0],'cloudSync':False,'ownerDataIncluded':False}))
    print('Self-contained desktop resources built; no owner research included.')


if __name__=='__main__':main()
