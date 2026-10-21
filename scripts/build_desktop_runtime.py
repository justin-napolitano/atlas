#!/usr/bin/env python3
"""Build a frozen owner API and offline resources; never copy owner state."""
import argparse
import hashlib
import json
import os
import re
from pathlib import Path
import shutil
import subprocess
import sys

ROOT=Path(__file__).resolve().parents[1]


def copy_postgres(source,destination):
    """Bundle only core tools and their actual dylib dependency closure."""
    pending=[source/'bin'/name for name in ['postgres','initdb','pg_ctl','pg_dump','pg_restore','pg_isready']]
    pending.extend((source/'lib/postgresql').glob('utf8_and_*.dylib'))
    modules={'plpgsql'}
    for file in (source/'share/postgresql').iterdir():
        if file.is_file() and file.suffix in ['.sql','.bki']:
            modules.update(re.findall(r'\$libdir/([A-Za-z0-9_]+)',file.read_text()))
    pending.extend(source/'lib/postgresql'/(name+'.dylib') for name in modules)
    seen=set()
    while pending:
        file=pending.pop();relative=file.relative_to(source)
        if relative in seen:continue
        seen.add(relative);target=destination/relative;target.parent.mkdir(parents=True,exist_ok=True)
        if file.is_symlink():
            canonical=file.resolve()
            target.symlink_to(os.path.relpath(destination/canonical.relative_to(source),target.parent))
            pending.append(canonical);continue
        shutil.copy2(file.resolve(),target)
        lines=subprocess.check_output(['/usr/bin/otool','-L',str(file)],text=True).splitlines()[1:]
        for line in lines:
            name=line.strip().split(' (compatibility version',1)[0]
            if name.startswith(('/usr/lib/','/System/Library/')):continue
            if file.suffix=='.dylib' and Path(name).name in {file.name,file.resolve().name}:continue # dylib install ID, not a dependency
            if name.startswith('@loader_path/'):
                dependency=(file.parent/name.removeprefix('@loader_path/')).resolve()
            elif name.startswith('@rpath/'):
                dependency=source/'lib'/name.removeprefix('@rpath/')
            elif '/Contents/Versions/17/' in name:
                dependency=source/name.split('/Contents/Versions/17/',1)[1]
            else:raise ValueError('Unexpected nonportable PostgreSQL dependency')
            if not dependency.is_relative_to(source):raise ValueError('PostgreSQL dependency outside verified distribution')
            pending.append(dependency)
    shared=source/'share/postgresql';target=destination/'share/postgresql'
    target.mkdir(parents=True)
    for file in shared.iterdir():
        if file.is_file():shutil.copy2(file,target/file.name)
        elif file.name in ['timezone','timezonesets','tsearch_data']:shutil.copytree(file,target/file.name)
    extension=target/'extension';extension.mkdir()
    for file in (shared/'extension').glob('plpgsql*'):shutil.copy2(file,extension/file.name)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--postgres',type=Path,required=True,help='Verified PostgreSQL 17 distribution (bin/lib/share)')
    args=parser.parse_args();postgres=args.postgres.resolve()
    for item in ['bin/postgres','bin/initdb','bin/pg_ctl','bin/pg_dump','bin/pg_restore','share/postgresql/postgres.bki']:
        if not (postgres/item).is_file():raise ValueError('Incomplete PostgreSQL distribution')
    version=subprocess.check_output([str(postgres/'bin/postgres'),'--version'],text=True).strip()
    if version!='postgres (PostgreSQL) 17.11 (Postgres.app)':raise ValueError('Expected pinned Postgres.app PostgreSQL 17.11')
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
    copy_postgres(postgres,output/'postgres')
    credits=postgres.parents[1]/'Resources/Credits.rtf'
    if credits.is_file():shutil.copy2(credits,output/'POSTGRES-CREDITS.rtf')
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
