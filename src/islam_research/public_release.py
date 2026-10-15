"""Strict public payloads, portable semantic metadata and immutable local releases.

This module has no database connection or private-state reader. A separate
restricted publisher supplies already-approved rows. Files are treated as data.
"""
from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import re
import shutil
import tempfile
from urllib.parse import urlsplit

from jsonschema import Draft202012Validator
from referencing import Registry

from .publication_contract import PUBLIC_KINDS, PUBLICATION_POLICY

MAX_PAYLOAD_BYTES = 2_000_000
MAX_RELEASE_BYTES = 20_000_000
MAX_PROJECTS = 100
UPSTREAM_COMMIT = "faf581054dcf7964d5fe0ceae7d6f415c8ce32a5"
LICENSE_FILES = ("osi-schema.json", "LICENSE", "LICENSE-Docs", "NOTICE")
UPSTREAM_HASHES = {
    'osi-schema.json':'c1e9adec39562786aa78809665fba568797b15f4c53a0847d9cbcf2dead1bc94',
    'LICENSE':'09e8a9bcec8067104652c168685ab0931e7868f9c8284b66f5ae6edae5f1130b',
    'LICENSE-Docs':'419896aea50c15d6e40c5b4baf4bd346f78223b9a354c7357ad00262afdc08ec',
    'NOTICE':'7019182b26179b19aae062a2d677f27435ff091c4de9ed1b6bd2734263d455a5',
}


class ActivationUncertain(RuntimeError):
    """The filesystem pointer may have committed before a later error occurred."""


def encoded(value):
    return (json.dumps(value,ensure_ascii=False,allow_nan=False,sort_keys=True,separators=(',',':'))+'\n').encode('utf-8')


def digest(data):
    return hashlib.sha256(data).hexdigest()


def _read(path,limit):
    if path.is_symlink(): raise ValueError("Release symlinks are forbidden")
    with path.open('rb') as handle: data=handle.read(limit+1)
    if len(data)>limit: raise ValueError("Release file exceeds its byte limit")
    return data


def strict_json(data,limit=MAX_PAYLOAD_BYTES):
    if not isinstance(data,bytes) or len(data)>limit:
        raise ValueError("Public JSON exceeds its byte limit")
    def pairs(items):
        result={}
        for key,value in items:
            if key in result: raise ValueError("Duplicate public JSON key")
            result[key]=value
        return result
    def constant(value): raise ValueError("Non-finite public JSON number")
    try:
        return json.loads(data.decode('utf-8'),object_pairs_hook=pairs,parse_constant=constant)
    except (UnicodeError,json.JSONDecodeError,RecursionError):
        raise ValueError("Invalid public JSON") from None


def _object(properties):
    return {"type":"object","properties":properties,"required":list(properties),"additionalProperties":False}


def payload_schema():
    text=lambda limit:{"type":"string","maxLength":limit,"pattern":r"^[^\x00]*$"}
    identifier={**text(500),"minLength":1,"pattern":r"^[^\x00-\x1f\x7f]+$"}
    strings=lambda limit,count:{"type":"array","items":text(limit),"maxItems":count}
    review={"enum":["pending","needs_followup","reviewed","disputed"]}
    node=_object({"id":identifier,"label":{**text(2000),"minLength":1},"type":{"enum":sorted(PUBLIC_KINDS)},
        "status":review,"origin":{"enum":["canonical_rdf","discovery","owner","proposal"]},
        "source_revision":{"type":"integer","minimum":1},"summary":text(50000),
        "scope":text(80040),"locator":text(80040),"citation":text(80040),"role":text(80040),
        "people":strings(4000,20),"links":{"type":"array","maxItems":20,"items":_object({"url":text(4000),"label":text(4000)})},
        "review_limits":{**strings(4000,21),"minItems":1}})
    edge=_object({"id":identifier,"from":identifier,"to":identifier,"predicate":identifier,
                  "label":text(500),"status":review})
    return _object({"format_version":{"const":1},"snapshot_id":{"type":"string","pattern":r"^publication-[a-f0-9]{32}$"},
        "generated_at":text(100),"curated_graph":{"enum":["canonical_rdf","hosted"]},
        "canonical_snapshot_sha256":{"type":"array","maxItems":100,"uniqueItems":True,"items":{"type":"string","pattern":r"^[a-f0-9]{64}$"}},
        "project":_object({"id":identifier,"title":{**text(2000),"minLength":1}}),
        "nodes":{"type":"array","minItems":1,"maxItems":100,"items":node},
        "edges":{"type":"array","maxItems":300,"items":edge},"candidates":{"const":[]},
        "publication":{"const":PUBLICATION_POLICY}})


def utc_timestamp(value):
    if not isinstance(value,str) or len(value)>100:
        raise ValueError("Invalid public timestamp")
    try:
        parsed=datetime.fromisoformat(value.replace('Z','+00:00'))
    except ValueError:
        raise ValueError("Invalid public timestamp") from None
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise ValueError("Public timestamps need an explicit timezone")
    return parsed.astimezone(timezone.utc).isoformat()


def validate_payload(payload,project_id,snapshot_id):
    validator=Draft202012Validator(payload_schema())
    if next(validator.iter_errors(payload),None) is not None:
        # Validation messages can contain draft values. Never echo them into build logs.
        raise ValueError("Published payload violates the allowlisted projection contract")
    if type(payload['format_version']) is not int or any(type(n['source_revision']) is not int for n in payload['nodes']):
        raise ValueError("Public versions must be integers")
    if payload['project']['id']!=project_id or payload['snapshot_id']!=snapshot_id:
        raise ValueError("Published head and snapshot identities disagree")
    utc_timestamp(payload['generated_at'])
    ids=[node['id'] for node in payload['nodes']];edges=[edge['id'] for edge in payload['edges']]
    if len(ids)!=len(set(ids)) or len(edges)!=len(set(edges)):
        raise ValueError("Duplicate published graph identity")
    for edge in payload['edges']:
        if edge['from'] not in ids or edge['to'] not in ids or not urlsplit(edge['predicate']).scheme:
            raise ValueError("Published relation has an unknown endpoint or predicate")
    for node in payload['nodes']:
        for link in node['links']:
            url=urlsplit(link['url']);host=url.hostname
            if url.scheme not in {'http','https'} or not host or url.username or url.password or url.query or any(ord(c)<33 for c in link['url']):
                raise ValueError("Unsafe public source link")
            if host=='localhost' or host.endswith(('.localhost','.local','.internal')):
                raise ValueError("Private source host cannot enter a release")
            try:
                address=ipaddress.ip_address(host)
            except ValueError:
                address=None
            if address is not None and not address.is_global:
                raise ValueError("Private source address cannot enter a release")
    if len(encoded(payload))>MAX_PAYLOAD_BYTES:
        raise ValueError("Published payload exceeds its byte limit")


def public_model():
    """Fixed Ossie metadata for logical views of approved JSON arrays, never SQL execution."""
    def dataset(name,fields):
        return {"name":name,"source":"approved_release."+name,"primary_key":["project_id","id"],
            "description":"Logical view materialized only from approved release JSON; not a live database binding.",
            "fields":[{"name":field,"expression":{"dialects":[{"dialect":"ANSI_SQL","expression":field}]}} for field in fields]}
    return {"version":"0.1.1","semantic_model":[{"name":"approved_public_research",
        "description":"Public projection metadata. Visibility approval does not establish scholarly correctness or consensus.",
        "datasets":[dataset("published_nodes",['project_id','id','label','type','status','origin','source_revision','summary','scope','locator','citation','role']),
                    dataset("published_edges",['project_id','id','from_id','to_id','predicate','status'])],
        "relationships":[{"name":"edge_source","from":"published_edges","to":"published_nodes","from_columns":["project_id","from_id"],"to_columns":["project_id","id"]},
                         {"name":"edge_target","from":"published_edges","to":"published_nodes","from_columns":["project_id","to_id"],"to_columns":["project_id","id"]}],
        "custom_extensions":[{"vendor_name":"COMMON","data":json.dumps({"research_platform":{
            "payload_version":1,"upstream_status":"release_candidate","execution":"metadata_only_no_model_SQL_execution",
            "json_bindings":{"published_nodes":"$.nodes","published_edges":"$.edges","project_id":"$.project.id","from_id":"edge.from","to_id":"edge.to"},
            "relation_meaning":"The recorded predicate carries meaning; a storage join does not prove scholarly support"}},sort_keys=True)}]}]}


def semantics_files(root):
    """Read pinned public schema/licenses only, never the private workspace model."""
    lock=strict_json(_read(root/'upstream.lock.json',100000),100000)
    if lock.get('commit')!=UPSTREAM_COMMIT or lock.get('core_version')!='0.1.1' or lock.get('files')!=UPSTREAM_HASHES:
        raise ValueError("Unsupported public semantic upstream")
    files={}
    for name in LICENSE_FILES:
        data=_read(root/'vendor/apache-ossie'/name,1_000_000)
        if len(data)>1_000_000 or digest(data)!=lock['files'][name]:
            raise ValueError("Pinned public schema/license content drift")
        files['semantic/vendor/apache-ossie/'+name]=data
    schema=strict_json(files['semantic/vendor/apache-ossie/osi-schema.json'])
    def deny_remote(uri): raise ValueError("Remote public schema retrieval is disabled")
    Draft202012Validator.check_schema(schema)
    model=public_model()
    Draft202012Validator(schema,registry=Registry(retrieve=deny_remote)).validate(model)
    files['semantic/publication.ossie.json']=encoded(model)
    files['semantic/upstream.json']=encoded({'commit':UPSTREAM_COMMIT,'core_version':'0.1.1','release_status':'release_candidate',
        'tag':'osi-0.1.1-rc1','upstream_repository':'https://github.com/apache/ossie','files':lock['files']})
    return files


def make_bundle(rows,semantic_root,*,exported_at=None):
    """Validate all supplied approved heads before any filesystem mutation."""
    created=utc_timestamp(exported_at or datetime.now(timezone.utc).isoformat())
    files=semantics_files(semantic_root);heads=[];projects=[];seen=set();total=0
    for row in rows:
        if len(heads)>=MAX_PROJECTS or row['project_id'] in seen or type(row['revision']) is not int or row['revision']<1:
            raise ValueError("Invalid, duplicate or excessive public heads")
        seen.add(row['project_id'])
        head={'project_id':row['project_id'],'revision':row['revision'],'status':row['status'],'snapshot_id':row['snapshot_id'],
              'changed_at':utc_timestamp(row['changed_at'])}
        if row['status']=='withdrawn':
            if row['snapshot_id'] is not None or row.get('payload_text') is not None:
                raise ValueError("Withdrawn head contains an active payload")
        elif row['status']=='published':
            raw=row.get('payload_text')
            if not isinstance(raw,str): raise ValueError("Approved snapshot is missing or too large")
            data=raw.encode('utf-8');total+=len(data)
            if total>MAX_RELEASE_BYTES or digest(data)!=row['payload_sha256']:
                raise ValueError("Approved snapshot digest or release size mismatch")
            payload=strict_json(data);validate_payload(payload,row['project_id'],row['snapshot_id'])
            filename='graph-'+digest(row['project_id'].encode('utf-8'))+'.json'
            files['data/'+filename]=encoded(payload)
            projects.append({'id':row['project_id'],'title':payload['project']['title'],'description':'Explicitly approved research snapshot; source review limits remain visible.',
                'status':'active','kind':'Research atlas','graph_data':filename,'default_view':'Map','privacy':'explicit_approved_projection'})
            head['payload_sha256']=row['payload_sha256'];head['published_at']=utc_timestamp(row['published_at'])
        else:
            raise ValueError("Unsupported public head state")
        heads.append(head)
    if not heads: raise ValueError("No publication decisions exist; do not replace the last good release with an empty database")
    heads.sort(key=lambda row:row['project_id']);projects.sort(key=lambda row:row['id'])
    files['data/projects.json']=encoded({'schema_version':1,'projects':projects,'delivery':'approved_snapshot_release'})
    files['data/release.json']=encoded({'format_version':1,'status':'exported','exported_at':created,
        'last_successful_export_at':created,'active_projects':len(projects),'withdrawn_projects':sum(h['status']=='withdrawn' for h in heads),
        'delivery':'immutable_approved_snapshot','deployed':False})
    if sum(map(len,files.values()))>MAX_RELEASE_BYTES: raise ValueError("Release exceeds its byte limit")
    manifest={'format_version':1,'exported_at':created,'heads':heads,'semantic_upstream_commit':UPSTREAM_COMMIT,
        'files':{name:{'sha256':digest(data),'bytes':len(data)} for name,data in sorted(files.items())}}
    identifier='release-'+digest(encoded(manifest));manifest['release_id']=identifier
    files['release-manifest.json']=encoded(manifest)
    return identifier,files


def _safe_root(root):
    root=Path(root).absolute()
    if root.is_symlink(): raise ValueError("Release root cannot be a symlink")
    # Canonicalize system aliases such as macOS /var -> /private/var. Internal
    # release entries and pointer paths still cannot be symlinks.
    return root.resolve()


def write_bundle(root,identifier,files):
    """Stage an immutable directory, then atomically replace only the current pointer."""
    root=_safe_root(root)
    if not re.fullmatch(r'release-[a-f0-9]{64}',identifier): raise ValueError("Invalid release identifier")
    root.mkdir(parents=True,exist_ok=True);releases=root/'releases';releases.mkdir(exist_ok=True)
    if releases.is_symlink(): raise ValueError("Release storage cannot be a symlink")
    stage=Path(tempfile.mkdtemp(prefix='.staging-',dir=releases));pointer=None
    try:
        for name,data in files.items():
            relative=Path(name)
            if relative.is_absolute() or '..' in relative.parts or not isinstance(data,bytes):
                raise ValueError("Invalid release path/content")
            target=stage/relative;target.parent.mkdir(parents=True,exist_ok=True)
            with target.open('xb') as handle: handle.write(data);handle.flush();os.fsync(handle.fileno())
        verify_bundle(stage,expected_id=identifier)
        target=releases/identifier
        if target.exists():
            verify_bundle(target,expected_id=identifier)
            if any((target/name).read_bytes()!=data for name,data in files.items()): raise ValueError("Immutable release collision")
        else:
            os.rename(stage,target)
        current=root/'current.json'
        if current.is_symlink(): raise ValueError("Current pointer cannot be a symlink")
        descriptor,temp=tempfile.mkstemp(prefix='.current-',dir=root);pointer=Path(temp)
        with os.fdopen(descriptor,'wb') as handle:
            handle.write(encoded({'release_id':identifier,'manifest_sha256':digest(files['release-manifest.json'])}));handle.flush();os.fsync(handle.fileno())
        os.replace(pointer,current);pointer=None
        return target
    finally:
        if stage.exists(): shutil.rmtree(stage)
        if pointer is not None: pointer.unlink(missing_ok=True)


def verify_bundle(directory,*,expected_id=None):
    directory=_safe_root(directory)
    manifest_path=directory/'release-manifest.json'
    if manifest_path.is_symlink(): raise ValueError("Release manifest cannot be a symlink")
    manifest=strict_json(_read(manifest_path,1_000_000),1_000_000)
    identifier=manifest.get('release_id');content={k:v for k,v in manifest.items() if k!='release_id'}
    if identifier!='release-'+digest(encoded(content)) or expected_id is not None and identifier!=expected_id:
        raise ValueError("Release identity mismatch")
    required={'format_version','exported_at','heads','semantic_upstream_commit','files','release_id'}
    if set(manifest)!=required or manifest['format_version']!=1 or manifest['semantic_upstream_commit']!=UPSTREAM_COMMIT:
        raise ValueError("Unsupported release manifest")
    utc_timestamp(manifest['exported_at'])
    expected=set(manifest['files'])|{'release-manifest.json'};actual=set();total=0
    for path in directory.rglob('*'):
        if path.is_symlink(): raise ValueError("Release symlinks are forbidden")
        if path.is_file(): actual.add(path.relative_to(directory).as_posix())
    if actual!=expected: raise ValueError("Release contains missing or unexpected files")
    for name,info in manifest['files'].items():
        path=Path(name)
        if path.is_absolute() or '..' in path.parts: raise ValueError("Unsafe release manifest path")
        if not (name in {'data/projects.json','data/release.json','semantic/publication.ossie.json','semantic/upstream.json'} or
                re.fullmatch(r'data/graph-[a-f0-9]{64}\.json',name) or name in {'semantic/vendor/apache-ossie/'+v for v in LICENSE_FILES}):
            raise ValueError("Unregistered release file")
        data=_read(directory/path,MAX_RELEASE_BYTES);total+=len(data)
        if total>MAX_RELEASE_BYTES or info!={'sha256':digest(data),'bytes':len(data)}: raise ValueError("Release file integrity mismatch")
    project_manifest=strict_json(_read(directory/'data/projects.json',1_000_000))
    health=strict_json(_read(directory/'data/release.json',10000))
    if set(project_manifest)!={'schema_version','projects','delivery'} or project_manifest['schema_version']!=1 or project_manifest['delivery']!='approved_snapshot_release':
        raise ValueError("Invalid public project index")
    if not isinstance(manifest['heads'],list) or not 1<=len(manifest['heads'])<=MAX_PROJECTS:
        raise ValueError("Invalid release head index")
    projects=project_manifest['projects'];head_ids=set();expected_graphs=set();expected_projects=[];withdrawn=0
    if not isinstance(projects,list): raise ValueError("Invalid public project index")
    for head in manifest['heads']:
        common={'project_id','revision','status','snapshot_id','changed_at'}
        if not isinstance(head,dict) or not isinstance(head.get('project_id'),str) or not 1<=len(head['project_id'])<=500 or head['project_id'] in head_ids or type(head.get('revision')) is not int or head['revision']<1:
            raise ValueError("Invalid release head")
        head_ids.add(head['project_id']);utc_timestamp(head['changed_at'])
        if head['status']=='withdrawn':
            if set(head)!=common or head['snapshot_id'] is not None: raise ValueError("Invalid withdrawn head")
            withdrawn+=1;continue
        if head['status']!='published' or set(head)!=common|{'payload_sha256','published_at'} or not re.fullmatch(r'[a-f0-9]{64}',head['payload_sha256']):
            raise ValueError("Invalid published head")
        utc_timestamp(head['published_at'])
        filename='graph-'+digest(head['project_id'].encode('utf-8'))+'.json';expected_graphs.add('data/'+filename)
        payload=strict_json(_read(directory/'data'/filename,MAX_PAYLOAD_BYTES));validate_payload(payload,head['project_id'],head['snapshot_id'])
        expected_projects.append({'id':head['project_id'],'title':payload['project']['title'],'description':'Explicitly approved research snapshot; source review limits remain visible.',
            'status':'active','kind':'Research atlas','graph_data':filename,'default_view':'Map','privacy':'explicit_approved_projection'})
    if projects!=sorted(expected_projects,key=lambda row:row['id']): raise ValueError("Public project/head mismatch")
    required_files={'data/projects.json','data/release.json','semantic/publication.ossie.json','semantic/upstream.json'}|{'semantic/vendor/apache-ossie/'+v for v in LICENSE_FILES}|expected_graphs
    if set(manifest['files'])!=required_files: raise ValueError("Release contains an unselected graph or missing contract")
    if health!={'format_version':1,'status':'exported','exported_at':manifest['exported_at'],'last_successful_export_at':manifest['exported_at'],
        'active_projects':len(projects),'withdrawn_projects':withdrawn,'delivery':'immutable_approved_snapshot','deployed':False}:
        raise ValueError("Invalid release health")
    if strict_json(_read(directory/'semantic/publication.ossie.json',1_000_000))!=public_model():
        raise ValueError("Unregistered public semantic model")
    upstream=strict_json(_read(directory/'semantic/upstream.json',100000))
    if upstream!={'commit':UPSTREAM_COMMIT,'core_version':'0.1.1','release_status':'release_candidate','tag':'osi-0.1.1-rc1','upstream_repository':'https://github.com/apache/ossie','files':UPSTREAM_HASHES}:
        raise ValueError("Invalid public semantic provenance")
    for name,checksum in UPSTREAM_HASHES.items():
        if digest(_read(directory/'semantic/vendor/apache-ossie'/name,1_000_000))!=checksum:
            raise ValueError("Public schema/license identity mismatch")
    return manifest


def current_bundle(root):
    root=_safe_root(root);pointer=root/'current.json'
    if pointer.is_symlink(): raise ValueError("Current pointer cannot be a symlink")
    value=strict_json(_read(pointer,1000),1000)
    if set(value)!={'release_id','manifest_sha256'} or not re.fullmatch(r'release-[a-f0-9]{64}',value['release_id']):
        raise ValueError("Invalid current release pointer")
    if (root/'releases').is_symlink(): raise ValueError("Release storage cannot be a symlink")
    directory=root/'releases'/value['release_id'];manifest=verify_bundle(directory,expected_id=value['release_id'])
    if digest(_read(directory/'release-manifest.json',1_000_000))!=value['manifest_sha256']:
        raise ValueError("Current release manifest mismatch")
    return directory,manifest
