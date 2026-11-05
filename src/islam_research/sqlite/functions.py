"""Small deterministic SQLite functions used by the existing domain queries."""
from datetime import datetime,timezone
import hashlib
import json
import re
import sqlite3
from functools import lru_cache


def json_value(value):
    if isinstance(value,(str,bytes)):
        return json.loads(value)
    return value


def json_text(value):
    """Match PostgreSQL JSONB text for existing content-addressed library IDs."""
    value=json_value(value)
    def ordered(v):
        if isinstance(v,dict):return {k:ordered(v[k]) for k in sorted(v,key=lambda k:(len(k.encode()),k.encode()))}
        if isinstance(v,list):return [ordered(x) for x in v]
        return v
    return json.dumps(ordered(value),ensure_ascii=False,allow_nan=False,separators=(', ',': '))


def dumps(value):
    return json.dumps(value,ensure_ascii=False,allow_nan=False,separators=(',',':'),default=lambda v:v.isoformat() if isinstance(v,datetime) else str(v))


def now():return datetime.now(timezone.utc).isoformat(timespec='microseconds')


def contains(left,right):
    if left is None or right is None:return None
    left,right=json_value(left),json_value(right)
    def check(a,b):
        if isinstance(b,dict):return isinstance(a,dict) and all(k in a and check(a[k],v) for k,v in b.items())
        if isinstance(b,list):return isinstance(a,list) and all(any(check(x,y) for x in a) for y in b)
        return type(a)==type(b) and a==b
    return check(left,right)


def json_type(value):
    if value is None:return None
    v=json_value(value)
    if v is None:return 'null'
    if isinstance(v,bool):return 'boolean'
    if isinstance(v,dict):return 'object'
    if isinstance(v,list):return 'array'
    if isinstance(v,str):return 'string'
    return 'number'


def register(connection):
    # A disposable native FTS5 index implements token matching without a second
    # editable authority or a persistent cache of private note text.
    index=sqlite3.connect(':memory:')
    index.execute("CREATE VIRTUAL TABLE document USING fts5(body,tokenize='unicode61')")
    index.execute("CREATE VIRTUAL TABLE query USING fts5(body,tokenize='unicode61')")
    index.execute("CREATE VIRTUAL TABLE vocabulary USING fts5vocab(query,'row')")
    @lru_cache(maxsize=64)
    def terms(query):
        index.execute('DELETE FROM query');index.execute('INSERT INTO query(body) VALUES(?)',(query,))
        return ' AND '.join('"'+row[0].replace('"','""')+'"' for row in index.execute('SELECT term FROM vocabulary ORDER BY term'))
    def lexical(text,query):
        if text is None or query is None:return False
        expression=terms(query)
        if not expression:return False
        index.execute('DELETE FROM document');index.execute('INSERT INTO document(body) VALUES(?)',(text,))
        return index.execute('SELECT 1 FROM document WHERE document MATCH ?',(expression,)).fetchone() is not None
    def equal(a,b):return None if a is None or b is None else json_value(a)==json_value(b)
    values={
        'atlas_json_text':(1,lambda v:None if v is None else json_text(v)),
        'atlas_json_equal':(2,equal),
        'atlas_json_type':(1,json_type),
        'atlas_to_json':(1,lambda v:dumps(v)),
        'atlas_contains':(2,contains),
        'atlas_has_key':(2,lambda v,k:None if v is None else k in json_value(v)),
        'atlas_has_keys':(2,lambda v,k:None if v is None else all(x in json_value(v) for x in json_value(k))),
        'atlas_sha256':(1,lambda v:hashlib.sha256(v if isinstance(v,bytes) else v.encode()).digest()),
        'atlas_convert_to':(2,lambda v,encoding:None if v is None else v.encode('utf-8')),
        'atlas_encode':(2,lambda v,encoding:None if v is None else v.hex()),
        'atlas_octet_length':(1,lambda v:None if v is None else len(v if isinstance(v,bytes) else v.encode())),
        'atlas_greatest':(-1,lambda *v:max((x for x in v if x is not None),default=None)),
        'atlas_least':(-1,lambda *v:min((x for x in v if x is not None),default=None)),
        'regexp_like':(2,lambda v,p:None if v is None or p is None else bool(re.search(p,v))),
        'regexp':(2,lambda p,v:None if v is None or p is None else bool(re.search(p,v))),
        'num_nonnulls':(-1,lambda *v:sum(x is not None for x in v)),
        'cardinality':(1,lambda v:None if v is None else len(json_value(v))),
        'atlas_array_at':(3,lambda v,n,base:None if v is None or n is None or not 0<=n-base<len(json_value(v)) else json_value(v)[n-base]),
        'btrim':(1,lambda v:None if v is None else v.strip()),
        'strpos':(2,lambda v,term:None if v is None or term is None else v.find(term)+1),
        'lower':(1,lambda v:None if v is None else v.lower()),
        'left':(2,lambda v,n:None if v is None or n is None else v[:n]),
        'atlas_time_text':(1,lambda v:None if v is None else datetime.fromisoformat(v).astimezone(timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.%f')),
    }
    for name,(count,function) in values.items():connection.create_function(name,count,function,deterministic=True)
    connection.create_function('atlas_now',0,now)
    connection.create_function('atlas_lexical_match',2,lexical)
