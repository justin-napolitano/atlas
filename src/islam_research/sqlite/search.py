"""Native FTS5 lexical retrieval for the advanced local search endpoint."""
import sqlite3


def search(connection,project_id,query,scope,kind,limit):
    if scope not in {'records','notes','annotations','all'} or not query.strip() or len(query)>500 or type(limit) is not int or not 1<=limit<=100:raise ValueError('Invalid search query')
    rows=connection.raw.execute("SELECT * FROM records WHERE project_id IS ? AND deleted_at IS NULL AND (? IS NULL OR kind=?)",(project_id,kind,kind)).fetchall()
    records={row['id']:row for row in rows}
    index=sqlite3.connect(':memory:')
    try:
        index.execute("CREATE VIRTUAL TABLE documents USING fts5(record_id UNINDEXED,channel UNINDEXED,target_id UNINDEXED,revision UNINDEXED,document_id UNINDEXED,capture_kind UNINDEXED,title,body,tokenize='unicode61')")
        index.execute('CREATE VIRTUAL TABLE query USING fts5(body)')
        index.execute("CREATE VIRTUAL TABLE vocabulary USING fts5vocab(query,'row')")
        index.execute('INSERT INTO query VALUES(?)',(query,))
        expression=' AND '.join('"'+row[0].replace('"','""')+'"' for row in index.execute('SELECT term FROM vocabulary ORDER BY term'))
        candidates=[]
        if scope in {'records','all'}:
            candidates.extend((row['id'],'record',row['id'],row['revision'],None,None,row['title'],row['summary']) for row in rows)
        if scope in {'notes','all'}:
            candidates.extend((row['record_id'],'private_note',row['record_id'],row['revision'],None,None,'',row['note']) for row in connection.raw.execute('SELECT * FROM personal_states WHERE project_id IS ?',(project_id,)) if row['record_id'] in records)
        if scope in {'annotations','all'}:
            candidates.extend((row['source_record_id'],'private_annotation',row['id'],row['revision'],row['document_id'],row['capture_kind'],'',row['exact']+' — '+row['body']) for row in connection.raw.execute("SELECT a.*,d.source_record_id FROM reading_annotations a JOIN reading_documents d ON d.id=a.document_id WHERE a.project_id IS ? AND NOT EXISTS(SELECT 1 FROM note_trash t WHERE t.project_id IS a.project_id AND t.target_kind='annotation' AND t.target_id=a.id AND t.state='trashed') AND NOT EXISTS(SELECT 1 FROM workspace_annotation_trash t WHERE t.annotation_id=a.id AND t.state='trashed')",(project_id,)) if row['source_record_id'] in records)
        if len(candidates)>100000:raise ValueError('Local search exceeds supported bound; narrow the project')
        index.executemany('INSERT INTO documents VALUES(?,?,?,?,?,?,?,?)',candidates)
        matches=index.execute("SELECT record_id,channel,target_id,revision,document_id,capture_kind,-bm25(documents,0,0,0,0,0,0,2,1) AS score,snippet(documents,-1,'','',' … ',40) FROM documents WHERE documents MATCH ? ORDER BY score DESC,record_id,target_id",(expression,)).fetchall() if expression else []
        grouped={}
        for record_id,channel,target_id,revision,document_id,capture_kind,score,excerpt in matches:
            item=grouped.setdefault(record_id,{'score':score,'matches':[],'matches_truncated':False})
            if sum(match['channel']==channel for match in item['matches'])>=5:item['matches_truncated']=True;continue
            item['matches'].append(dict(channel=channel,target_id=target_id,revision=revision,document_id=document_id,capture_kind=capture_kind,score=score,excerpt=excerpt,review_state='captured_unreviewed' if channel=='private_annotation' else None))
        items=[{key:records[id][key] for key in ['id','project_id','kind','title','revision','review_state']}|{'summary':records[id]['summary'][:2000],'summary_truncated':len(records[id]['summary'])>2000}|value for id,value in grouped.items()]
        return dict(items=items[:limit],truncated=len(items)>limit,scope=scope,method='sqlite_fts5_unicode61_v1',query_semantics='all_tokenized_terms',score_meaning='Positive inverse BM25 rank within local candidates; not scholarly quality or semantic relevance',record_weights={'title':2,'summary':1},max_matches_per_channel=5,excerpt_format='plain_text_treat_as_untrusted_text_never_HTML',limitations=['SQLite tokenization and ranking differ from hosted PostgreSQL','No Arabic morphology, synonyms, embeddings or transliteration equivalence'])
    finally:index.close()
