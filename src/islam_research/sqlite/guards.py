"""SQLite equivalents of the curated store's identity and revision triggers.

These functions are installed as SQLite triggers, so they also apply to writes
outside the HTTP adapter. They receive typed rows, never executable owner content.
Import mode is private to the verified snapshot importer; ordinary API writes
cannot enable it. Native foreign keys and CHECK constraints remain enabled.
"""
from functools import lru_cache
import hashlib
import json
import sqlite3
from uuid import UUID

from psycopg.errors import CheckViolation,ForeignKeyViolation
from sqlglot import exp,parse_one
from .dialect import TABLES,row_json
from . import functions

HISTORY={
 'records':('record_revisions',{'record_id':'id'}),
 'personal_states':('personal_state_revisions',{'record_id':'record_id'}),
 'reading_annotations':('reading_annotation_revisions',{'annotation_id':'id'}),
 'reading_drafts':('reading_draft_revisions',{'draft_id':'id'}),
 'reading_desks':('reading_desk_revisions',{'project_id':'project_id'}),
 'notebook_entries':('notebook_revisions',{'project_id':'project_id','entry_id':'id'}),
 'notebook_drafts':('notebook_draft_revisions',{'draft_id':'id'}),
 'note_trash':('note_trash_revisions',{'project_id':'project_id','target_kind':'target_kind','target_id':'target_id'}),
 'quran_reading_progress':('quran_progress_revisions',{'project_id':'project_id','chapter':'chapter','ayah':'ayah'}),
 'workspace_quran_reading_progress':('workspace_quran_progress_revisions',{'workspace_id':'workspace_id','chapter':'chapter','ayah':'ayah'}),
 'workspace_reading_desks':('workspace_reading_desk_revisions',{'workspace_id':'workspace_id'}),
 'workspace_note_trash':('workspace_note_trash_history',{'entry_id':'entry_id'}),
 'workspace_annotation_trash':('workspace_annotation_trash_history',{'annotation_id':'annotation_id'}),
 'scripture_citations':('scripture_citation_revisions',{'citation_id':'id'}),
 'verse_materials':('verse_material_revisions',{'material_id':'id'}),
 'desktop_page_positions':('desktop_page_history',{'entry_id':'entry_id'}),
 'desktop_folders':('desktop_folder_history',{'folder_id':'id'}),
}
LEXICON={'lexicon_'+v for v in ['entries','forms','representations','senses','definitions','occurrences']}
ORGANIZATION={'workspace_'+v for v in ['collections','collection_items','saved_views','connections','investigations']}
IMMUTABLE={t for t in TABLES if t.endswith(('_revisions','_history'))}|{'reading_documents','source_intakes','lexicon_captures','workspace_reflections','workspace_legacy_collections','publication_previews','publication_events','public_snapshots','library_events'}


def require(value,foreign=False):
    if not value:raise (ForeignKeyViolation if foreign else CheckViolation)('Embedded storage invariant rejected the change')


def keys(table):
    constraint=next(c['definition'] for c in TABLES[table]['constraints'] if c['contype']=='p')
    return [s.strip().strip('"') for s in constraint[constraint.index('(')+1:constraint.index(')')].split(',')]


def statements():
    result=[]
    for table in TABLES:
        for operation in ['INSERT','UPDATE','DELETE']:
            new=row_json(table,'NEW').sql('sqlite') if operation!='DELETE' else 'NULL'
            old=row_json(table,'OLD').sql('sqlite') if operation!='INSERT' else 'NULL'
            for phase in ['BEFORE','AFTER']:
                result.append(f'CREATE TRIGGER "atlas_{table}_{operation.lower()}_{phase.lower()}" {phase} {operation} ON "{table}" BEGIN SELECT atlas_{phase.lower()}(\'{table}\',\'{operation}\',{new},{old}); END;')
    return result


def schema_hash(raw):
    rows=raw.execute("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").fetchall()
    return hashlib.sha256(functions.dumps(rows).encode()).hexdigest()


@lru_cache(maxsize=1)
def expected_schema():
    from .connection import baseline
    raw=sqlite3.connect(':memory:')
    raw.row_factory=lambda cursor,row:{item[0]:value for item,value in zip(cursor.description,row)}
    functions.register(raw)
    raw.create_function('atlas_before',4,lambda *v:None);raw.create_function('atlas_after',4,lambda *v:None)
    raw.executescript(baseline())
    raw.execute('CREATE TABLE atlas_storage_migrations(version INTEGER PRIMARY KEY,sha256 TEXT NOT NULL)')
    for statement in statements():raw.execute(statement)
    digest=schema_hash(raw);raw.close();return digest


class Guards:
    def __init__(self,connection):self.connection=connection;self.raw=connection.raw;self.publication=False
    def register(self):
        def invoke(method,table,operation,new,old):
            if self.connection._internal or self.connection._importing:return None
            try:return method(table,operation,json.loads(new) if new else None,json.loads(old) if old else None)
            except Exception as error:
                self.connection._last_error=error
                raise
        self.raw.create_function('atlas_before',4,lambda *v:invoke(self.before,*v))
        self.raw.create_function('atlas_after',4,lambda *v:invoke(self.after,*v))
        self.raw.create_function('library_id',2,self.library_id,deterministic=True)
        self.raw.create_function('index_library_source',1,self.index_source)
        self.raw.create_function('to_regclass',1,lambda value: ('public_'+value.split('.',1)[1] if value.startswith('research_public.') else value.removeprefix('research.')) if value.removeprefix('research.').removeprefix('research_public.') in {t['name'] for t in TABLES.values()} else None)
    def install(self):
        for statement in statements():self.raw.execute(statement)
    def check_schema(self):require(schema_hash(self.raw)==expected_schema())
    def one(self,table,**where):
        require(table in TABLES)
        return self.raw.execute('SELECT * FROM "'+table+'" WHERE '+' AND '.join('"'+key+'" IS ?' for key in where),tuple(where.values())).fetchone()
    def scoped(self,table,id,project,global_scope=False):
        row=self.one(table,id=id)
        return row if row and (global_scope and project is None or row.get('project_id')==project) else None
    def write(self,table,values):
        from .connection import adapt
        require(table in TABLES)
        names=list(values)
        self.raw.execute('INSERT INTO "'+table+'" ('+','.join('"'+n+'"' for n in names)+') VALUES('+','.join('?' for n in names)+')',tuple(adapt(v) for v in values.values()))
    def correct(self,table,new,changes):
        from .connection import adapt
        if changes:
            identity=keys(table)
            self.raw.execute('UPDATE "'+table+'" SET '+','.join('"'+n+'"=?' for n in changes)+' WHERE '+' AND '.join('"'+n+'" IS ?' for n in identity),tuple(adapt(v) for v in changes.values())+tuple(new[n] for n in identity))
            new.update(changes)
    def unchanged(self,new,old,names):
        if old:require(all(new.get(name)==old.get(name) for name in names))
    def selector(self,new,document):
        require(document and new['text_sha256']==document['text_sha256'])
        start,end=new['start_pos'],new['end_pos'];text=document['text_body']
        require(0<=start<end<=len(text) and new['exact']==text[start:end] and new['prefix']==text[max(0,start-40):start] and new['suffix']==text[end:end+40])
    def before(self,table,operation,new,old):
        if operation=='DELETE':require(False)
        if operation=='UPDATE':require(table not in IMMUTABLE)
        for col in TABLES[table]['columns']:
            value=new.get(col['column_name'])
            if value is not None and col['udt_name']=='uuid':
                try:UUID(str(value))
                except (ValueError,TypeError):require(False)
        if old:self.unchanged(new,old,['id','workspace_id','project_id','creation_sha256'])
        revisioned=table in HISTORY or table in LEXICON|ORGANIZATION|{'library_items','library_project_items'}
        if revisioned:require(new['revision']==(old['revision']+1 if old else 1))
        if table=='records':self.unchanged(new,old,['project_id','kind','origin'])
        if table=='reading_documents':
            record=self.scoped('records',new['source_record_id'],new['project_id'])
            require(record and record['kind'] in {'source','work','edition'} and (new['project_id'] is not None or record['deleted_at'] is None))
        if table=='source_intakes':
            record=self.scoped('records',new['source_record_id'],new['project_id'])
            require(record and record['kind'] in {'source','work','edition'} and record['deleted_at'] is None)
            if new['document_id']:
                document=self.scoped('reading_documents',new['document_id'],new['project_id'])
                require(document and document['source_record_id']==record['id'])
        if table in {'notebook_entries','reading_annotations'} and old:
            kind='entry' if table=='notebook_entries' else 'annotation'
            require(not self.one('note_trash',project_id=old['project_id'],target_kind=kind,target_id=old['id']) or self.one('note_trash',project_id=old['project_id'],target_kind=kind,target_id=old['id'])['state']!='trashed')
            trash=self.one('workspace_note_trash' if kind=='entry' else 'workspace_annotation_trash',**{('entry_id' if kind=='entry' else 'annotation_id'):old['id']})
            require(not trash or trash['state']!='trashed')
        if table=='reading_annotations':
            self.unchanged(new,old,['project_id','document_id','text_sha256','start_pos','end_pos','exact','prefix','suffix','capture_kind'])
            self.selector(new,self.scoped('reading_documents',new['document_id'],new['project_id']))
        if table=='notebook_entries':self.notebook(new,old)
        if table=='notebook_drafts':self.notebook_draft(new,old)
        if table=='reading_drafts':self.reading_draft(new,old)
        if table=='personal_states':
            self.unchanged(new,old,['record_id','project_id'])
            record=self.scoped('records',new['record_id'],new['project_id'])
            require(record and record['deleted_at'] is None,foreign=True)
        if table in {'quran_reading_progress','workspace_quran_reading_progress'}:self.unchanged(new,old,['project_id','workspace_id','chapter','ayah'])
        if table in {'reading_desks','workspace_reading_desks'}:self.reading_desk(table,new,old)
        if table in {'note_trash','workspace_note_trash','workspace_annotation_trash'}:self.trash(table,new,old)
        if table in ORGANIZATION:self.unchanged(new,old,['created_at','target_kind','target_id','collection_id','from_kind','from_id','to_kind','to_id'])
        if table in {'desktop_folders','desktop_page_positions'}:self.placement(table,new,old)
        if table in {'desktop_page_positions','desktop_page_intents'} and new['folder_id'] is not None:
            folder=self.one('desktop_folders',id=new['folder_id']);require(folder and folder['state']=='active')
        if table=='library_items':self.unchanged(new,old,['work_id','created_at'])
        if table=='library_project_items':self.unchanged(new,old,['item_id','project_id'])
        if table=='vault_sync_pages':
            self.unchanged(new,old,['entry_id'])
            require(self.one('notebook_entries',id=new['entry_id']) or self.one('reading_annotations',id=new['entry_id']))
        if table in LEXICON:self.lexicon(table,new,old)
        if table=='scripture_citations':self.citation(new,old)
        if table=='verse_materials':self.verse(new,old)
        if table in {'publication_previews','publication_events','public_snapshots','public_publication_heads'}:self.publication_guard(table,new,old)
    def notebook(self,new,old):
        self.unchanged(new,old,['project_id','record_id','document_id','annotation_id','reading_position','review_state'])
        project=new['project_id'];document=None
        if new['record_id']:
            record=self.scoped('records',new['record_id'],project,True);require(record and record['deleted_at'] is None)
        if new['document_id']:
            document=self.scoped('reading_documents',new['document_id'],project,True);require(document and document['source_record_id']==new['record_id'])
        if new['reading_position'] is not None:require(document and new['reading_position']<=len(document['text_body']))
        if new['annotation_id']:
            annotation=self.scoped('reading_annotations',new['annotation_id'],project,True)
            require(annotation and document and annotation['document_id']==document['id'] and annotation['text_sha256']==document['text_sha256'] and document['text_body'][annotation['start_pos']:annotation['end_pos']]==annotation['exact'])
        seen=set()
        for link in new['links']:
            require(isinstance(link,dict) and set(link)=={'kind','id','rationale'} and all(isinstance(v,str) for v in link.values()) and 1<=len(link['id'].strip())<=500 and 1<=len(link['rationale'].strip())<=2000)
            kind=link['kind'];require(kind in {'record','annotation','entry'} and (kind!='entry' or link['id']!=new['id']))
            target=self.scoped({'record':'records','annotation':'reading_annotations','entry':'notebook_entries'}[kind],link['id'],project,True)
            require(target and (kind!='record' or target['deleted_at'] is None) and (kind!='entry' or target['state']=='active'))
            if kind=='annotation':
                doc=self.one('reading_documents',id=target['document_id']);record=self.one('records',id=doc['source_record_id']);require(record and record['deleted_at'] is None)
            identity=(kind,link['id']);require(identity not in seen);seen.add(identity)
    def notebook_draft(self,new,old):
        self.unchanged(new,old,['project_id','entry_id','request_uuid','record_id','document_id','annotation_id','reading_position','base_revision','base_snapshot'])
        if not old and new['entry_id']:
            baseline=self.one('notebook_revisions',entry_id=new['entry_id'],revision=new['base_revision'],project_id=new['project_id'])
            require(baseline and new['base_snapshot']==baseline['snapshot'])
            require(all(new[k]==baseline['snapshot'].get(k) for k in ['record_id','document_id','annotation_id','reading_position']))
        elif not old:require(new['base_snapshot'] is None)
        value=new['value']
        require(isinstance(value,dict) and set(value)=={'thought_type','title','body','links','state'} and isinstance(value['title'],str) and isinstance(value['body'],str) and isinstance(value['links'],list) and len(value['links'])<=25 and value['thought_type'] in {'note','question','source_claim','interpretation','objection','decision','principle','skill'} and value['state'] in {'active','withdrawn'})
        if new['reading_position'] is not None:
            document=self.scoped('reading_documents',new['document_id'],new['project_id'],True)
            require(document and document['source_record_id']==new['record_id'] and new['reading_position']<=len(document['text_body']))
    def reading_draft(self,new,old):
        self.unchanged(new,old,['project_id','record_id','context_kind','document_id','annotation_id','text_sha256','start_pos','end_pos','exact','prefix','suffix','base_revision','base_snapshot'])
        if new['context_kind']!='capture':self.unchanged(new,old,['capture_kind'])
        record=self.scoped('records',new['record_id'],new['project_id']);require(record and record['deleted_at'] is None)
        if new['context_kind']!='record_note':
            document=self.scoped('reading_documents',new['document_id'],new['project_id'])
            require(document and record['kind'] in {'source','work','edition'} and document['source_record_id']==record['id']);self.selector(new,document)
            if new['context_kind']=='annotation':
                annotation=self.scoped('reading_annotations',new['annotation_id'],new['project_id'])
                require(annotation and all(annotation[k]==new[k] for k in ['document_id','text_sha256','start_pos','end_pos','exact','capture_kind']))
        if not old and new['context_kind']!='capture' and new['base_revision']:
            history='personal_state_revisions' if new['context_kind']=='record_note' else 'reading_annotation_revisions'
            key='record_id' if history=='personal_state_revisions' else 'annotation_id'
            baseline=self.one(history,**{key:new[key],'revision':new['base_revision']})
            require(baseline and baseline['snapshot']['project_id']==new['project_id'])
    def reading_desk(self,table,new,old):
        self.unchanged(new,old,['workspace_id','project_id'])
        project=new.get('project_id');record=self.scoped('records',new['record_id'],project)
        require(record and record['kind'] in {'source','work','edition'} and record['deleted_at'] is None)
        if new['document_id']:
            document=self.scoped('reading_documents',new['document_id'],project)
            require(document and document['source_record_id']==new['record_id'] and (new['end_pos'] is None or new['end_pos']<=len(document['text_body'])))
        if new['annotation_id']:
            annotation=self.scoped('reading_annotations',new['annotation_id'],project)
            require(annotation and all(annotation[k]==new[k] for k in ['document_id','start_pos','end_pos']))
    def trash(self,table,new,old):
        if table=='note_trash':
            self.unchanged(new,old,['project_id','target_kind','target_id']);target='notebook_entries' if new['target_kind']=='entry' else 'reading_annotations';id=new['target_id']
        else:
            key='entry_id' if table=='workspace_note_trash' else 'annotation_id';self.unchanged(new,old,[key]);id=new[key];target='notebook_entries' if key=='entry_id' else 'reading_annotations'
        row=self.scoped(target,id,new.get('project_id'));require(row and row['revision']==new['target_revision'])
    def placement(self,table,new,old):
        folder=table=='desktop_folders';key='id' if folder else 'entry_id';limit=16 if folder else 32
        self.unchanged(new,old,[key]);identity=new[key]
        if folder:require(not old or old['state']=='active');require(old or new['state']=='active')
        nodes={row[key]:row for row in self.raw.execute('SELECT * FROM "'+table+'"').fetchall()}
        if not folder:
            for row in self.raw.execute('SELECT id FROM notebook_entries'):
                nodes.setdefault(row['id'],{'parent_id':None})
        parent=new['parent_id'];ancestors=0;seen={identity}
        while parent is not None:
            require(parent not in seen and parent in nodes);seen.add(parent);ancestors+=1;require(ancestors<=limit)
            if folder:require(nodes[parent]['state']=='active')
            parent=nodes[parent]['parent_id']
        queue=[(identity,1 if folder else 0)];depth=0
        while queue:
            id,d=queue.pop();depth=max(depth,d);require(d<=limit)
            queue.extend((id2,d+1) for id2,row in nodes.items() if row['parent_id']==id and (not folder or row['state']=='active'))
        require(ancestors+depth<=limit)
        if folder and new['state']=='removed':
            require(not any(row['parent_id']==identity and row['state']=='active' for row in nodes.values()))
            require(not self.raw.execute('SELECT 1 FROM desktop_page_positions WHERE folder_id=?',(identity,)).fetchone())
    def after(self,table,operation,new,old):
        if operation=='DELETE':return
        self.connection._internal+=1
        try:
            changes={}
            if 'updated_at' in new:changes['updated_at']=functions.now()
            if old and 'created_at' in new:changes['created_at']=old['created_at']
            if table in {'quran_reading_progress','workspace_quran_reading_progress'}:
                changes['read_at']=(old and old['read_at'] or functions.now()) if new['is_read'] else None
            if table=='library_items':changes['retained_at']=((old and old['retained_at']) or functions.now()) if new['on_shelf'] else (old and old['retained_at'])
            if table=='reading_drafts' and not old:
                kind=new['context_kind'];base=new['base_revision']
                if kind=='capture':snapshot={}
                elif kind=='record_note' and not base:snapshot={'note':'','revision':0}
                else:
                    baseline=self.one('personal_state_revisions' if kind=='record_note' else 'reading_annotation_revisions',**{('record_id' if kind=='record_note' else 'annotation_id'):new['record_id'] if kind=='record_note' else new['annotation_id'],'revision':base})['snapshot']
                    snapshot={'note':baseline['note'],'revision':base} if kind=='record_note' else {'body':baseline['body'],'mark_style':baseline.get('mark_style','highlight'),'revision':base}
                changes['base_snapshot']=snapshot
            self.correct(table,new,changes)
            if table in HISTORY:
                target,identity=HISTORY[table];self.write(target,{**{k:new[v] for k,v in identity.items()},'revision':new['revision'],'snapshot':new})
            if table in LEXICON:self.write('lexicon_revisions',{'entity_table':table,'entity_id':new['id'],'revision':new['revision'],'snapshot':new})
            if table in ORGANIZATION:
                identity=new['id'] if 'id' in new else [new[k] for k in (['collection_id','target_kind','target_id'] if 'collection_id' in new else ['target_kind','target_id'])]
                self.write('workspace_organization_history',{'entity':table,'identity':functions.dumps(identity),'revision':new['revision'],'snapshot':new})
            if table in {'library_items','library_project_items'}:
                self.write('library_events',{'target_kind':'item' if table=='library_items' else 'membership','target_id':new.get('id',new.get('item_id')),**({'project_id':new['project_id']} if table=='library_project_items' else {}),'revision':new['revision'],'snapshot':new})
            if old and table in {'notebook_entries','reading_annotations'}:
                self.raw.execute('UPDATE vault_sync_pages SET dirty_revision=?,updated_at=atlas_now() WHERE entry_id=?',(new['revision'],new['id']))
        finally:self.connection._internal-=1
    def returned(self,query,rows):
        tree=parse_one(query,read='postgres')
        target=tree.this.this if isinstance(tree.this,exp.Schema) else tree.this
        if not isinstance(target,exp.Table):return rows
        table=('public_' if target.db=='research_public' else '')+target.name
        if table not in TABLES:return rows
        identity=keys(table)
        result=[]
        for row in rows:
            if all(key in row for key in identity):
                fresh=self.one(table,**{key:row[key] for key in identity})
                result.append({key:fresh.get(key,value) for key,value in row.items()} if fresh else row)
            else:result.append(row)
        return result
    @staticmethod
    def library_id(kind,identity):return 'urn:research:library:'+kind+':'+hashlib.sha256(functions.json_text(identity).encode()).hexdigest()
    def index_source(self,source_id):
        record=self.one('records',id=source_id);require(record and record['workspace_id']=='owner' and record['kind'] in {'source','work','edition'})
        work=self.library_id('work',functions.dumps(source_id));item=self.library_id('item',functions.dumps(source_id))
        self.raw.execute('INSERT INTO library_works(id,title,legacy_source_id,identity_basis) VALUES(?,?,?,?) ON CONFLICT(id) DO NOTHING',(work,record['title'],source_id,'source_unresolved' if record['project_id'] is None else 'legacy_source_unresolved'))
        self.raw.execute("INSERT INTO library_items(id,work_id,changed_by) VALUES(?,?,'identity-migration-v1') ON CONFLICT(id) DO NOTHING",(item,work))
        self.raw.execute('INSERT INTO library_source_bindings(source_record_id,project_id,item_id,work_id,source_revision) VALUES(?,?,?,?,?) ON CONFLICT(source_record_id) DO NOTHING',(source_id,record['project_id'],item,work,record['revision']))
        if record['project_id'] is not None:self.raw.execute("INSERT INTO library_project_items(item_id,project_id,state,changed_by) VALUES(?,?,'legacy','identity-migration-v1') ON CONFLICT(item_id,project_id) DO NOTHING",(item,record['project_id']))
        for document in self.raw.execute('SELECT * FROM reading_documents WHERE source_record_id=? AND project_id IS ?',(source_id,record['project_id'])).fetchall():
            edition=self.library_id('edition',functions.dumps([work,document['edition'],document['representation_url']]))
            notice=hashlib.sha256(document['source_notice'].encode()).hexdigest()
            representation=self.library_id('representation',functions.dumps([work,document['edition'],document['representation_url'],document['locator'],document['text_sha256'],notice,document['normalization']]))
            self.raw.execute('INSERT INTO library_editions(id,work_id,label,representation_url) VALUES(?,?,?,?) ON CONFLICT(id) DO NOTHING',(edition,work,document['edition'],document['representation_url']))
            self.raw.execute('INSERT INTO library_representations(id,work_id,edition_id,locator,text_sha256,notice_sha256,normalization) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING',(representation,work,edition,document['locator'],document['text_sha256'],notice,document['normalization']))
            self.raw.execute('INSERT INTO library_document_bindings(document_id,project_id,source_record_id,work_id,representation_id) VALUES(?,?,?,?,?) ON CONFLICT(document_id) DO NOTHING',(document['id'],document['project_id'],source_id,work,representation))
        return item
    def lexicon(self,table,new,old):
        mutable={
            'lexicon_entries':{'scope','entry_type'},'lexicon_forms':{'rationale','form_kind'},
            'lexicon_representations':{'rationale'},'lexicon_senses':{'scope','rationale','state'},
            'lexicon_definitions':{'wording_mode','body','attribution','scope','dating_note','rationale','search_key','state'},
            'lexicon_occurrences':{'rationale','state'},
        }[table]|{'revision','changed_by','created_at','updated_at'}
        self.unchanged(new,old,set(new)-mutable)
        project=new['project_id']
        if table in {'lexicon_senses','lexicon_definitions'}:
            concept=self.scoped('records',new['concept_id'],project)
            require(concept and concept['kind']=='concept' and concept['deleted_at'] is None)
        if table=='lexicon_definitions':
            capture=self.scoped('reading_annotations',new['annotation_id'],project)
            require(capture and (new['wording_mode']!='quotation' or new['body']==capture['exact']))
            if new['attribution_person_id']:
                person=self.scoped('records',new['attribution_person_id'],project)
                require(person and person['kind']=='person' and person['deleted_at'] is None)
        if table=='lexicon_representations':
            capture=self.scoped('reading_annotations',new['origin_annotation_id'],project)
            require(capture and new['origin_end']<=len(capture['exact']) and new['written_rep']==capture['exact'][new['origin_start']:new['origin_end']])
        if table=='lexicon_occurrences':
            capture=self.scoped('reading_annotations',new['annotation_id'],project)
            require(capture and new['document_id']==capture['document_id'] and new['text_sha256']==capture['text_sha256'] and new['term_end']<=len(capture['exact']) and new['exact']==capture['exact'][new['term_start']:new['term_end']])
            representation=self.scoped('lexicon_representations',new['representation_id'],project)
            require(representation and representation['written_rep']==new['exact'])
            form=self.scoped('lexicon_forms',representation['form_id'],project)
            sense=self.scoped('lexicon_senses',new['sense_id'],project)
            require(form and sense and form['entry_id']==sense['entry_id'] and (new['state']=='withdrawn' or sense['state']=='active'))
    def citation(self,new,old):
        self.unchanged(new,old,['id','project_id','annotation_id','document_id','text_sha256','candidate_key','parser_version','detector_kind','match_start','match_end','matched_text','proposal','profile_id'])
        capture=self.scoped('reading_annotations',new['annotation_id'],new['project_id'])
        require(capture and new['document_id']==capture['document_id'] and new['text_sha256']==capture['text_sha256'] and new['match_end']<=len(capture['exact']) and new['matched_text']==capture['exact'][new['match_start']:new['match_end']])
        if new['decision']=='confirmed':
            from ..quran_citations import reference
            reference(new['chapter'],new['ayah_start'],new['ayah_end'])
    def verse(self,new,old):
        from ..quran_citations import reference
        reference(new['chapter'],new['ayah_start'],new['ayah_end'])
        self.unchanged(new,old,['id','project_id','annotation_id','document_id','text_sha256','creation_sha256','profile_id','chapter','ayah_start','ayah_end','material_kind','link_kind','citation_basis','citation_id','citation_snapshot','marker_start','marker_end','marker_text'])
        if not old:require(new['state']=='active')
        capture=self.scoped('reading_annotations',new['annotation_id'],new['project_id'])
        require(capture and new['document_id']==capture['document_id'] and new['text_sha256']==capture['text_sha256'])
        require(new['assertion_mode']!='quotation' or new['assertion_text']==capture['exact'])
        if new['citation_basis']!='none':require(new['marker_end']<=len(capture['exact']) and new['marker_text']==capture['exact'][new['marker_start']:new['marker_end']])
        if not old and new['citation_basis']=='resolved_reference':
            citation=self.scoped('scripture_citations',new['citation_id'],new['project_id'])
            require(citation and citation['decision']=='confirmed' and citation['detector_kind']!='owner_mapping' and json.loads(functions.dumps(citation))==new['citation_snapshot'] and all(citation[k]==new[k] for k in ['annotation_id','profile_id','chapter','ayah_start','ayah_end']) and citation['match_start']==new['marker_start'] and citation['match_end']==new['marker_end'] and citation['matched_text']==new['marker_text'])
    def publication_guard(self,table,new,old):
        # Publishing belongs to the hosted PostgreSQL role boundary. The private
        # desktop retains imported publication history but cannot advance it.
        raise PermissionError('Publish research through the hosted owner workspace')
