"""Portable standalone page codec. No filesystem, network or implicit data migration."""
from __future__ import annotations

import hashlib
import json
import re
import uuid
from importlib.resources import files

from jsonschema import Draft202012Validator,ValidationError

from . import notebook, workspace_store

PREFIX='urn:research:notebook:'
MAX_MARKDOWN_BYTES=80000
MAX_MANIFEST_BYTES=65536
SCHEMA=json.loads(files('islam_research').joinpath('resources/vault-page.schema.json').read_text())
VALIDATOR=Draft202012Validator(SCHEMA)


def identity(value):
    """Return the canonical UUID4 suffix; reject aliases and path-shaped IDs."""
    if not isinstance(value,str) or not value.startswith(PREFIX):raise ValueError('Invalid vault page identity')
    suffix=value[len(PREFIX):]
    try:parsed=uuid.UUID(suffix)
    except (ValueError,TypeError,AttributeError):raise ValueError('Invalid vault page identity') from None
    if parsed.version!=4 or str(parsed)!=suffix:raise ValueError('Invalid vault page identity')
    return suffix


def paths(entry_id):
    """V1 paths are derived exclusively from the immutable page ID."""
    key=identity(entry_id)
    return f'.atlas/pages/{key}.json',f'notes/{key}.md'


def known_frontmatter_type(body):
    """Project a recognized type from bounded failsafe YAML without constructors.

    Invalid/unfinished headers remain ordinary saved writing. Alias, duplicate-key,
    custom-tag and resource-limit failures never apply a classification.
    """
    import yaml
    first=re.match(r'^---[ \t]*\r?\n',body)
    if not first:return None
    closing=re.search(r'^(?:---|\.\.\.)[ \t]*(?:\r?\n|$)',body[first.end():],re.M)
    if not closing:return None
    header=body[first.end():first.end()+closing.start()]
    if len(header)+first.end()>8192:return None
    try:
        depth=count=0
        for event in yaml.parse(header,Loader=yaml.BaseLoader):
            count+=1
            if count>1024 or isinstance(event,yaml.AliasEvent):return None
            if isinstance(event,(yaml.MappingStartEvent,yaml.SequenceStartEvent)):depth+=1
            if depth>8:return None
            if isinstance(event,(yaml.MappingEndEvent,yaml.SequenceEndEvent)):depth-=1
        node=yaml.compose(header,Loader=yaml.BaseLoader)
        count=0
        def value(item,level=0):
            nonlocal count
            count+=1
            if count>512 or level>8:raise ValueError()
            if item.tag=='tag:yaml.org,2002:str':return item.value
            if item.tag=='tag:yaml.org,2002:seq':return [value(child,level+1) for child in item.value]
            if item.tag!='tag:yaml.org,2002:map':raise ValueError()
            result={}
            for key,child in item.value:
                key=value(key,level+1)
                if not isinstance(key,str) or key in result:raise ValueError()
                result[key]=value(child,level+1)
            return result
        result=value(node)
        kind=result.get('type') if isinstance(result,dict) else None
        return kind if isinstance(kind,str) and kind in notebook.TYPES else None
    except (yaml.YAMLError,ValueError,TypeError,AttributeError,RecursionError):return None


def exclusion(row):
    """Explain unsupported dependencies without copying or remapping them."""
    if row.get('trashed') or row.get('state','active')!='active':return 'Trash or withdrawn writing remains local'
    if row.get('project_id') is not None:return 'Legacy project context is not portable yet'
    if any(row.get(field) is not None for field in ('record_id','document_id','annotation_id','reading_position')) or row.get('quran_context'):
        return 'Source or reading context is not portable yet'
    if row.get('thought_type')=='source_claim':return 'Source claims require their original exact annotation'
    if any(link.get('kind')!='entry' for link in row.get('links',[])):return 'Source references require their original dependencies'
    return None


def encode_page(row):
    """Return the metadata and exact Markdown files for one supported saved page."""
    reason=exclusion(row)
    if reason:raise ValueError(reason)
    manifest_path,body_path=paths(row['id'])
    body=row['body']
    values=notebook.metadata(row['thought_type'],row['title'],body,row.get('links',[]),'active')
    kind=known_frontmatter_type(body)
    if kind and kind!=values['thought_type']:raise ValueError('Frontmatter classification needs reconciliation')
    metadata=dict(format=1,id=row['id'],path=body_path,title=values['title'],title_mode=row.get('title_mode','manual'),
                  thought_type=values['thought_type'],state='active',links=values['links'])
    try:VALIDATOR.validate(metadata)
    except ValidationError:raise ValueError('Invalid vault page metadata') from None
    for link in values['links']:identity(link['id'])
    content=body.encode('utf-8')
    if len(content)>MAX_MARKDOWN_BYTES:raise ValueError('Vault Markdown is too large')
    return {manifest_path:(json.dumps(metadata,ensure_ascii=False,sort_keys=True,indent=2)+'\n').encode('utf-8'),body_path:content}


def _unique(pairs):
    result={}
    for key,value in pairs:
        if key in result:raise ValueError('Duplicate vault metadata key')
        result[key]=value
    return result


def decode_page(manifest_path,manifest,body_path,content):
    """Validate an untrusted file pair; never read any supplied path from disk."""
    if not isinstance(manifest,bytes) or len(manifest)>MAX_MANIFEST_BYTES or not isinstance(content,bytes) or len(content)>MAX_MARKDOWN_BYTES:
        raise ValueError('Invalid vault file size')
    try:
        metadata=json.loads(manifest.decode('utf-8'),object_pairs_hook=_unique)
        VALIDATOR.validate(metadata)
        expected_manifest,expected_body=paths(metadata['id'])
        if manifest_path!=expected_manifest or body_path!=expected_body or metadata['path']!=expected_body:
            raise ValueError('Vault path does not match its stable page identity')
        body=content.decode('utf-8')
        kind=known_frontmatter_type(body) or metadata['thought_type']
        if kind=='source_claim':raise ValueError('Source claim dependencies are unavailable')
        values=notebook.metadata(kind,metadata['title'],body,metadata['links'],'active')
        if any(link['kind']!='entry' for link in values['links']):raise ValueError('Unsupported source dependency')
        for link in values['links']:identity(link['id'])
        if metadata['title_mode']=='automatic':values['title']=workspace_store.derived_title(body)
        return dict(id=metadata['id'],title_mode=metadata['title_mode'],**values)
    except (UnicodeError,json.JSONDecodeError,RecursionError,ValidationError) as error:raise ValueError('Invalid vault file') from error


def fingerprint(page):
    """Content identity is independent of database revision and remote Git SHA."""
    return hashlib.sha256(json.dumps(page,sort_keys=True,ensure_ascii=False,separators=(',',':')).encode()).hexdigest()


def import_new_pages(connection,pages,*,actor):
    """Atomically import a bounded closed set into existing note authorities.

    Only creates absent pages or verifies exact existing content. Updates/conflict
    resolution are the later sync service's responsibility. Cycles use two passes.
    """
    if not isinstance(pages,list) or not 1<=len(pages)<=50:raise ValueError('Import between one and fifty pages')
    identifiers={page['id'] for page in pages}
    if len(identifiers)!=len(pages):raise ValueError('Duplicate vault page identity')
    new=[]
    with connection.transaction():
        for page in pages:
            encoded=encode_page(page)
            paths_=paths(page['id']);checked=decode_page(paths_[0],encoded[paths_[0]],paths_[1],encoded[paths_[1]])
            if checked!=page:raise ValueError('Page is not a validated portable page')
            old=workspace_store.note(connection,page['id'])
            if old:
                if exclusion(old) or any(old[key]!=page[key] for key in page if key not in {'id'}):raise ValueError('Existing page differs; explicit sync resolution required')
                continue
            for link in page['links']:
                if link['id'] not in identifiers and not workspace_store.note(connection,link['id']):raise ValueError('Vault page dependency is missing')
            request_uuid=identity(page['id'])
            workspace_store.create_note(connection,request_uuid=request_uuid,body=page['body'],actor=actor,
                title=page['title'] if page['title_mode']=='manual' else '',thought_type=page['thought_type'],links=[])
            new.append(page)
        for page in new:
            if page['links']:
                workspace_store.update_note(connection,entry_id=page['id'],expected_revision=1,actor=actor,body=page['body'],
                    title=page['title'] if page['title_mode']=='manual' else '',title_mode=page['title_mode'],thought_type=page['thought_type'],links=page['links'])
    return dict(created=[page['id'] for page in new],unchanged=sorted(identifiers-{page['id'] for page in new}))
