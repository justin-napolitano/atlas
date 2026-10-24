"""Versioned, exact-byte backup coverage. Git commit identity stays outside itself."""
from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
import re
import uuid

from . import vault_format as codec

MAX_BYTES=65536
EXCLUDED_MATERIAL=['Unselected pages','Source-bound notes and annotations','Reading positions and progress',
                   'Drafts, revision history and Trash','Original files','GitHub tasks and comments','Folder hierarchy']


def path(identifier):
    value=uuid.UUID(str(identifier))
    if value.version!=4 or str(value)!=str(identifier):raise ValueError('Invalid backup identity')
    return '.atlas/backups/'+str(value)+'.json'


def make(identifier,actions):
    path(identifier)
    pages=[];excluded=[]
    for item in actions:
        if item['action']=='excluded':
            excluded.append(dict(id=item['id'],application_revision=item['revision'],reason=item['reason']))
            continue
        files=codec.encode_page(item['local']);metadata,body=codec.paths(item['id'])
        pages.append(dict(id=item['id'],application_revision=item['revision'],
                          markdown_sha256=hashlib.sha256(files[body]).hexdigest(),
                          metadata_sha256=hashlib.sha256(files[metadata]).hexdigest()))
    return dict(format=1,kind='atlas-application-note-backup',id=str(identifier),
                created_at=datetime.now(timezone.utc).isoformat(),scope='selected_saved_standalone_pages',
                selected_count=len(actions),covered_count=len(pages),pages=pages,excluded=excluded,
                excluded_material=list(EXCLUDED_MATERIAL))


def encode(value):
    raw=(json.dumps(value,ensure_ascii=False,sort_keys=True,indent=2)+'\n').encode('utf-8')
    decode(path(value['id']),raw)
    return raw


def decode(filename,raw):
    if not isinstance(raw,bytes) or len(raw)>MAX_BYTES:raise ValueError('Backup coverage is too large')
    try:value=json.loads(raw.decode('utf-8'),object_pairs_hook=codec._unique)
    except (ValueError,UnicodeError,RecursionError):raise ValueError('Invalid backup coverage') from None
    required={'format','kind','id','created_at','scope','selected_count','covered_count','pages','excluded','excluded_material'}
    if not isinstance(value,dict) or set(value)!=required or value['format']!=1 or type(value['format']) is not int:
        raise ValueError('Unsupported backup coverage version')
    if filename!=path(value['id']) or value['kind']!='atlas-application-note-backup' or value['scope']!='selected_saved_standalone_pages':
        raise ValueError('Backup identity or scope does not match')
    try:
        timestamp=datetime.fromisoformat(value['created_at'])
        if timestamp.tzinfo is None:raise ValueError()
    except (TypeError,ValueError):raise ValueError('Invalid backup timestamp') from None
    if not isinstance(value['pages'],list) or not isinstance(value['excluded'],list) or not 1<=len(value['pages'])<=10 or len(value['pages'])+len(value['excluded'])>10:
        raise ValueError('Invalid backup page coverage')
    if type(value['selected_count']) is not int or type(value['covered_count']) is not int or value['covered_count']!=len(value['pages']) or value['selected_count']!=len(value['pages'])+len(value['excluded']):
        raise ValueError('Backup counts do not match')
    if value['excluded_material']!=EXCLUDED_MATERIAL:raise ValueError('Unsupported backup exclusions')
    seen=set()
    for item,is_excluded in [(item,False) for item in value['pages']]+[(item,True) for item in value['excluded']]:
        if not isinstance(item,dict):raise ValueError('Invalid backup page')
        codec.identity(item.get('id'))
        if item['id'] in seen:raise ValueError('Duplicate backup page')
        seen.add(item['id'])
        if type(item.get('application_revision')) is not int or item['application_revision']<1:raise ValueError('Invalid application revision')
        if is_excluded:
            if set(item)!={'id','application_revision','reason'} or not isinstance(item['reason'],str) or not 1<=len(item['reason'])<=1000:
                raise ValueError('Invalid exclusion')
        elif set(item)!={'id','application_revision','markdown_sha256','metadata_sha256'} or any(not isinstance(item.get(k),str) or not re.fullmatch('[a-f0-9]{64}',item[k]) for k in ('markdown_sha256','metadata_sha256')):
            raise ValueError('Invalid page digests')
    return value


def verify_page(item,files):
    metadata,body=codec.paths(item['id'])
    if hashlib.sha256(files[body]).hexdigest()!=item['markdown_sha256'] or hashlib.sha256(files[metadata]).hexdigest()!=item['metadata_sha256']:
        raise ValueError('Backup page does not match its coverage digest')
    return codec.decode_page(metadata,files[metadata],body,files[body])
