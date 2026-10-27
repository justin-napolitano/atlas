"""Verified, lossless table snapshots for local PostgreSQL to SQLite migration."""
from datetime import datetime,timezone
import hashlib
import json
from uuid import UUID

from .connection import Connection,adapt,migrate
from .dialect import TABLES
from . import functions


def canonical(value):
    if isinstance(value,datetime):return value.astimezone(timezone.utc).isoformat(timespec='microseconds')
    if isinstance(value,UUID):return str(value)
    if isinstance(value,dict):return {key:canonical(item) for key,item in value.items()}
    if isinstance(value,(list,tuple)):return [canonical(item) for item in value]
    return value


def fingerprint(rows):
    encoded=[json.dumps(canonical(row),ensure_ascii=False,sort_keys=True,separators=(',',':')) for row in rows]
    return hashlib.sha256(('\n'.join(sorted(encoded))).encode()).hexdigest()


def capture_postgres(connection):
    """Caller holds a repeatable-read snapshot; never prints or uploads contents."""
    from psycopg import sql
    tables={}
    applied=dict(connection.execute('SELECT name,sha256 FROM research.schema_migrations').fetchall())
    from .dialect import SCHEMA
    if applied!=SCHEMA['source_migrations']:raise ValueError('PostgreSQL schema needs the reviewed migration baseline')
    for name,metadata in TABLES.items():
        columns=[column['column_name'] for column in metadata['columns']]
        query=sql.SQL('SELECT {} FROM {}.{}').format(sql.SQL(',').join(map(sql.Identifier,columns)),sql.Identifier(metadata['schema']),sql.Identifier(metadata['name']))
        rows=[canonical(dict(zip(columns,row))) for row in connection.execute(query).fetchall()]
        tables[name]={'rows':rows,'count':len(rows),'sha256':fingerprint(rows)}
    return {'format':'atlas-sqlite-migration-v1','tables':tables}


def inventory(connection):
    return {name:{'count':len(rows),'sha256':fingerprint(rows)} for name in TABLES for rows in [connection.raw.execute('SELECT * FROM "'+name+'"').fetchall()]}


def verify(connection,expected):
    if connection.raw.execute('PRAGMA integrity_check').fetchone()['integrity_check']!='ok':raise ValueError('SQLite integrity check failed')
    if connection.raw.execute('PRAGMA foreign_key_check').fetchall():raise ValueError('SQLite foreign key check failed')
    if inventory(connection)!=expected:raise ValueError('Migrated row counts or exact-content fingerprints differ')
    connection.guards.check_schema()


def import_postgres(snapshot,path):
    if snapshot.get('format')!='atlas-sqlite-migration-v1' or set(snapshot['tables'])!=set(TABLES):raise ValueError('Unsupported migration snapshot')
    expected={name:{'count':value['count'],'sha256':value['sha256']} for name,value in snapshot['tables'].items()}
    for value in snapshot['tables'].values():
        if len(value['rows'])!=value['count'] or fingerprint(value['rows'])!=value['sha256']:raise ValueError('Migration snapshot fingerprint failed')
    with Connection(path,create=True) as connection:
        migrate(connection)
        connection._importing=True
        try:
            with connection.transaction():
                connection.raw.execute('PRAGMA defer_foreign_keys=ON')
                for name in TABLES:connection.raw.execute('DELETE FROM "'+name+'"')
                for name,metadata in TABLES.items():
                    columns=[column['column_name'] for column in metadata['columns']]
                    query='INSERT INTO "'+name+'" ('+','.join('"'+column+'"' for column in columns)+') VALUES('+','.join('?' for _ in columns)+')'
                    connection.raw.executemany(query,[tuple(adapt(row[column]) for column in columns) for row in snapshot['tables'][name]['rows']])
                verify(connection,expected)
        finally:connection._importing=False
    # Reopen with the same private-file boundary used by the running service.
    with Connection(path) as connection:verify(connection,expected)
    return {'verified':True,'tables':len(expected),'rows':sum(value['count'] for value in expected.values()),'inventory':expected}
