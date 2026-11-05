#!/usr/bin/env python3
"""Compile the reviewed schema metadata into a native SQLite baseline, without data."""
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'src'))
import sqlglot
from sqlglot import exp
from islam_research.sqlite.dialect import SCHEMA,TABLES,expression,translate


def quote(value):return '"'+value.replace('"','""')+'"'


def generate():
    statements=['-- SQLite baseline v1, mapped from the committed PostgreSQL schema through 0038.',
                '-- PostgreSQL migrations remain authoritative for hosted deployments.']
    for name,table in TABLES.items():
        parts=[]
        auto=name=='library_events'
        for col in table['columns']:
            key=col['column_name'];kind=col['data_type']
            if auto and key=='event_id':parts.append('"event_id" INTEGER PRIMARY KEY AUTOINCREMENT');continue
            native='INTEGER' if kind in {'bigint','integer','boolean'} else 'TEXT'
            part=quote(key)+' '+native
            if col['is_nullable']=='NO':part+=' NOT NULL'
            if col['column_default'] is not None:part+=' DEFAULT ('+expression(col['column_default'])+')'
            if kind in {'jsonb','ARRAY'}:part+=' CHECK ('+quote(key)+' IS NULL OR json_valid('+quote(key)+'))'
            if kind=='boolean':part+=' CHECK ('+quote(key)+' IS NULL OR '+quote(key)+' IN (0,1))'
            if kind=='integer':part+=' CHECK ('+quote(key)+' IS NULL OR '+quote(key)+' BETWEEN -2147483648 AND 2147483647)'
            parts.append(part)
        for constraint in table['constraints']:
            if auto and constraint['contype']=='p':continue
            if constraint['contype'] not in {'p','u','f','c'}:raise ValueError('Unmapped SQLite constraint')
            sql='CREATE TABLE research.__constraint (sentinel TEXT, CONSTRAINT '+quote(constraint['conname'])+' '+constraint['definition']+')'
            converted,_=translate(sql)
            tree=sqlglot.parse_one(converted,read='sqlite')
            parts.append(tree.this.expressions[1].sql('sqlite'))
        statements.append('CREATE TABLE '+quote(name)+' (\n  '+',\n  '.join(parts)+'\n);')
    for name,table in TABLES.items():
        for index in table['indexes']:
            # PK/UNIQUE declarations create these indexes. Full-text search has a
            # separate native FTS5 index rather than emulating PostgreSQL tsvector.
            if any(c['conname']==index['indexname'] for c in table['constraints']) or ' USING gin ' in index['indexdef']:continue
            tree=sqlglot.parse_one(index['indexdef'],read='postgres')
            tree.this.args['params'].set('using',None)
            for order in tree.find_all(exp.Ordered):order.set('nulls_first',not order.args.get('desc',False))
            converted,_=translate(tree.sql('postgres'))
            statements.append(converted+';')
    return '\n\n'.join(statements)+'\n'


if __name__=='__main__':
    import argparse
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--check',action='store_true');args=parser.parse_args()
    root=Path(__file__).resolve().parents[1]
    import hashlib
    migrations={path.name:hashlib.sha256(path.read_bytes()).hexdigest() for path in (root/'src/islam_research/migrations').glob('*.sql')}
    if migrations!=SCHEMA['source_migrations']:raise SystemExit('PostgreSQL baseline changed; review the SQLite schema mapping')
    output=root/'src/islam_research/sqlite/0001_workspace.sql'
    value=generate()
    if args.check:
        if output.read_text()!=value:raise SystemExit('SQLite baseline differs from committed metadata')
        print('Native SQLite baseline matches committed metadata.')
    else:
        output.write_text(value)
        print('Native SQLite baseline generated from committed metadata.')
