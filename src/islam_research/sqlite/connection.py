"""Private-file SQLite connections with bounded transactions and typed rows.

Rollback journaling and FULL synchronization are deliberate for the single-owner
desktop. SQLite remains entirely in process; no server or network DSN is accepted.
"""
from contextlib import contextmanager
from datetime import datetime
import hashlib
from importlib.resources import files
import json
import os
import fcntl
import re
from pathlib import Path
import sqlite3
import stat
import time
from urllib.parse import quote
from uuid import UUID

import psycopg.errors
from . import dialect,functions

JSON_NAMES=dialect.JSON_COLUMNS|{'source','target','inputs','head','matches','identity','counts','quran_context','evidence_snapshot','node'}
BOOL_NAMES=dialect.BOOL_COLUMNS|{'ready','summary_truncated','matches_truncated','replayed','source_active','source_available','trashed','citation_changed_needs_review'}


def decode(name,value):
    if value is None:return None
    if name in JSON_NAMES and isinstance(value,(str,bytes)):
        try:return json.loads(value)
        except (ValueError,UnicodeDecodeError):return value
    if name in dialect.TIME_COLUMNS and isinstance(value,str):return datetime.fromisoformat(value)
    if name in BOOL_NAMES:return bool(value)
    return value


def adapt(value):
    if hasattr(value,'obj'):return functions.json_text(functions.dumps(value.obj))
    if isinstance(value,(dict,list)):return functions.json_text(functions.dumps(value))
    if isinstance(value,datetime):return value.isoformat()
    if isinstance(value,UUID):return str(value)
    return value


def private_file(path,create=False):
    path=Path(path).absolute()
    parent=path.parent.lstat()
    if not stat.S_ISDIR(parent.st_mode) or parent.st_uid!=os.getuid() or parent.st_mode&0o077:
        raise ValueError('Owner-private SQLite directory required')
    fd=os.open(path,os.O_RDWR|os.O_NOFOLLOW|(os.O_CREAT|os.O_EXCL if create else 0),0o600)
    try:
        info=os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_uid!=os.getuid() or info.st_mode&0o077:
            raise ValueError('Owner-private SQLite file required')
    finally:os.close(fd)
    return path


class Cursor:
    def __init__(self,rows=(),rowcount=-1,description=None):
        self.rows=list(rows);self.position=0;self.rowcount=rowcount;self.description=description
    def fetchone(self):
        if self.position>=len(self.rows):return None
        row=self.rows[self.position];self.position+=1;return row
    def fetchall(self):
        rows=self.rows[self.position:];self.position=len(self.rows);return rows
    def __iter__(self):
        while (row:=self.fetchone()) is not None:yield row


class Connection:
    backend='sqlite'
    def __init__(self,path,*,create=False):
        self.path=private_file(path,create)
        self.raw=sqlite3.connect('file:'+quote(str(self.path))+'?mode=rw',uri=True,isolation_level=None,timeout=5)
        self.raw.row_factory=lambda cursor,row:{item[0]:decode(item[0],value) for item,value in zip(cursor.description,row)}
        self.raw.enable_load_extension(False)
        self.raw.execute('PRAGMA foreign_keys=ON');self.raw.execute('PRAGMA busy_timeout=5000')
        self.raw.execute('PRAGMA synchronous=FULL');self.raw.execute('PRAGMA recursive_triggers=OFF')
        if self.raw.execute('PRAGMA journal_mode').fetchone()['journal_mode']!='delete':
            self.raw.close();raise ValueError('Embedded storage requires rollback journaling')
        self._autocommit=False;self._internal=0;self._importing=False;self._last_error=None;self._readonly=False;self._session_locks={}
        functions.register(self.raw)
        from .guards import Guards
        self.guards=Guards(self)
        self.guards.register()
    @property
    def autocommit(self):return self._autocommit
    @autocommit.setter
    def autocommit(self,value):
        if self.raw.in_transaction:self.raw.commit()
        self._autocommit=bool(value)
    def _writer(self):
        if self._readonly:raise psycopg.errors.ReadOnlySqlTransaction('Read-only snapshot')
        if not self.raw.in_transaction:self.raw.execute('BEGIN IMMEDIATE')
    @contextmanager
    def transaction(self):
        outer=self.raw.in_transaction
        name='atlas_'+str(self._internal)+'_'+str(time.monotonic_ns())
        if outer:self.raw.execute('SAVEPOINT '+name)
        else:self._writer()
        try:
            yield self
            if outer:self.raw.execute('RELEASE SAVEPOINT '+name)
            else:self.raw.commit()
        except BaseException:
            if outer:self.raw.execute('ROLLBACK TO SAVEPOINT '+name);self.raw.execute('RELEASE SAVEPOINT '+name)
            else:self.raw.rollback()
            raise
    def execute(self,query,params=()):
        if not isinstance(query,str):query=query.as_string()
        normalized=' '.join(query.split()).upper()
        session_lock=re.fullmatch(r'SELECT PG_ADVISORY_(LOCK|UNLOCK)\((\d+),\s*(\d+)\)',normalized)
        if session_lock:
            action,left,right=session_lock.groups();key=(left,right)
            if action=='LOCK' and key not in self._session_locks:
                fd=os.open(self.path.parent/('sqlite-advisory-'+left+'-'+right+'.lock'),os.O_CREAT|os.O_RDWR|os.O_NOFOLLOW,0o600)
                info=os.fstat(fd)
                if info.st_uid!=os.getuid() or info.st_mode&0o077 or not stat.S_ISREG(info.st_mode):os.close(fd);raise ValueError('Private advisory lock required')
                try:fcntl.flock(fd,fcntl.LOCK_EX)
                except BaseException:os.close(fd);raise
                self._session_locks[key]=fd
            elif action=='UNLOCK' and key in self._session_locks:os.close(self._session_locks.pop(key))
            return Cursor([{'pg_advisory_'+action.lower():True}],1)
        if normalized.startswith('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ'):
            if not self.raw.in_transaction:self.raw.execute('BEGIN')
            self._readonly=normalized.endswith('READ ONLY');return Cursor()
        if normalized.startswith('SELECT PG_ADVISORY_XACT_LOCK('):self._writer();return Cursor([{'pg_advisory_xact_lock':None}],1)
        sql,writer=dialect.translate(query)
        auto=writer and self._autocommit and not self.raw.in_transaction
        if writer:self._writer()
        if not self._internal:self._last_error=None
        try:
            cursor=self.raw.execute(sql,{'atlas_p'+str(i):adapt(v) for i,v in enumerate(params)})
            rows=cursor.fetchall() if cursor.description else []
            # SQLite RETURNING precedes AFTER-trigger corrections. Return the
            # committed-in-transaction row, including its timestamp/history fields.
            if writer and rows:rows=self.guards.returned(query,rows)
            if auto:self.raw.commit()
            return Cursor(rows,cursor.rowcount,cursor.description)
        except sqlite3.Error as error:
            if auto:self.raw.rollback()
            if self._last_error is not None:
                original=self._last_error;self._last_error=None;raise original from None
            message=str(error)
            if isinstance(error,sqlite3.IntegrityError):
                kind=psycopg.errors.ForeignKeyViolation if 'FOREIGN KEY' in message else psycopg.errors.UniqueViolation if 'UNIQUE' in message else psycopg.errors.NotNullViolation if 'NOT NULL' in message else psycopg.errors.CheckViolation
                raise kind('Embedded storage constraint rejected the change') from None
            if 'locked' in message or 'busy' in message:raise psycopg.errors.SerializationFailure('Embedded storage is busy; retry the unchanged revision') from None
            raise
    def commit(self):self.raw.commit()
    def rollback(self):self.raw.rollback()
    def close(self):
        try:self.raw.close()
        finally:
            for fd in self._session_locks.values():os.close(fd)
            self._session_locks.clear()
    def __enter__(self):return self
    def __exit__(self,kind,value,traceback):
        try:
            if kind:self.raw.rollback()
            else:self.raw.commit()
        finally:self.close()


def baseline():return files(__package__).joinpath('0001_workspace.sql').read_text()


def migrate(connection):
    raw=connection.raw
    if raw.execute("SELECT count(*) AS n FROM sqlite_schema WHERE type='table' AND name='atlas_storage_migrations'").fetchone()['n']:
        row=raw.execute('SELECT version,sha256 FROM atlas_storage_migrations ORDER BY version DESC LIMIT 1').fetchone()
        if row!={'version':1,'sha256':hashlib.sha256(baseline().encode()).hexdigest()}:raise ValueError('Unknown or changed SQLite migration')
        connection.guards.check_schema()
        return []
    if raw.execute("SELECT count(*) AS n FROM sqlite_schema WHERE type='table'").fetchone()['n']:
        raise ValueError('Unrecognized SQLite database; existing file retained')
    raw.execute('PRAGMA journal_mode=DELETE')
    raw.executescript(baseline())
    raw.execute('CREATE TABLE atlas_storage_migrations(version INTEGER PRIMARY KEY,sha256 TEXT NOT NULL)')
    raw.execute('INSERT INTO atlas_storage_migrations VALUES(1,?)',(hashlib.sha256(baseline().encode()).hexdigest(),))
    connection.guards.install()
    raw.execute("INSERT INTO owner_workspaces(id,title) VALUES('owner','Owner workspace')")
    raw.executemany('INSERT INTO schema_migrations(name,sha256) VALUES(?,?)',dialect.SCHEMA['source_migrations'].items())
    raw.execute('PRAGMA application_id=1096043603')
    raw.execute('PRAGMA user_version=1')
    connection.guards.check_schema()
    return ['sqlite/0001_workspace.sql']
