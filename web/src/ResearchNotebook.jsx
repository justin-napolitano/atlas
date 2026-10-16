import React,{useEffect,useMemo,useRef,useState} from 'react';
import {newThought,notebookKey,notebookMetadata,saveThought,thoughtLabel,thoughtTypes,verifyThought} from './notebookClient.js';
import './researchNotebook.css';
import NotebookConnections from './NotebookConnections.jsx';
import NotebookMarkdown from './NotebookMarkdown.jsx';
import NotebookNetwork from './NotebookNetwork.jsx';
import NotebookSourcePane from './NotebookSourcePane.jsx';
import {quoteCapture,quoteMarkdown} from './notebookCitation.js';
import {verifyReadingCapture} from './readingMarks.js';
import {PassageNoteEditor} from './passageNoteEditor.js';
import {notebookGraph} from './notebookMarkdown.js';

/** Running project notebook. Passage bodies are a live server projection, never copied here. */
export default function ResearchNotebook({api,projectId,drafts,changed=()=>{},onOpenSource,anchor=null,initialQuery='',initialEntryId='',projectTitle='',onEntryChange=()=>{},inlineSources=false,noteEditor=null,initialCollection='all'}){
  const [rows,setRows]=useState([]),[cursor,setCursor]=useState(null),[query,setQuery]=useState(initialQuery),[kind,setKind]=useState(''),[state,setState]=useState('active');
  const [selected,setSelected]=useState(null),[cloud,setCloud]=useState(null),[message,setMessage]=useState(''),[loading,setLoading]=useState(false),[history,setHistory]=useState(null);
  const [collection,setCollection]=useState(initialCollection);
  function chooseCollection(next){setCollection(next);setKind('');load('',query,{thoughtType:'',noteState:state,itemScope:next});}
  const [sourceTarget,setSourceTarget]=useState(null),sourceTrigger=useRef(null);
  const localNoteEditor=useRef(null);if(!localNoteEditor.current)localNoteEditor.current=new PassageNoteEditor(api,changed);
  function openSource(recordId,targetProject=projectId,annotationId='',documentId=''){if(targetProject!==projectId)return;if(inlineSources){sourceTrigger.current=window.document.activeElement;setShowGraph(false);setSourceTarget({recordId,annotationId,documentId});}else onOpenSource?.(recordId,targetProject,annotationId,documentId);}
  const [mobileEditor,setMobileEditor]=useState(false);
  const [editorMode,setEditorMode]=useState('write'),[network,setNetwork]=useState(null),[networkError,setNetworkError]=useState(''),[networkLoading,setNetworkLoading]=useState(false),[showGraph,setShowGraph]=useState(false);
  const networkGeneration=useRef(0),networkBusy=useRef(false),quoteBusy=useRef(false);
  const graph=useMemo(()=>notebookGraph(network?.items || [],{complete:!network?.truncated}),[network]);
  const [link,setLink]=useState({kind:'record',id:'',rationale:''});
  const [,render]=useState(0),generation=useRef(0),mounted=useRef(true),busy=useRef(false),selection=useRef(null),activeProject=useRef(projectId);
  activeProject.current=projectId;
  const key=notebookKey(projectId,selected || 'new'),draft=drafts.current.get(key),quoteKey='notebook-quote:'+key,quoteDraft=drafts.current.get(quoteKey);
  function remember(value,at=key){drafts.current.set(at,value);changed();render(v=>v+1);}
  function clear(at=key){drafts.current.delete(at);changed();render(v=>v+1);}
  async function load(after='',queryValue=query,{thoughtType=kind,noteState=state,itemScope=collection}={}){
    const token=++generation.current;setLoading(true);setMessage('');
    try{const page=await api.request('notebook/items',{project_id:projectId,q:queryValue,thought_type:thoughtType,state:noteState,item_scope:itemScope,cursor:after,limit:25});
      if(!Array.isArray(page.items) || page.items.some(r=>r.project_id!==projectId))throw new Error('Notebook list did not match this project.');
      if(mounted.current && token===generation.current){setRows(old=>after?[...old,...page.items]:page.items);setCursor(page.next_cursor);}}
    catch(error){if(mounted.current && token===generation.current)setMessage(error.message);}
    finally{if(mounted.current && token===generation.current)setLoading(false);}
  }
  useEffect(()=>{let active=true;mounted.current=true;selection.current=null;setQuery(initialQuery);setSelected(null);setCloud(null);setRows([]);setHistory(null);load('',initialQuery).then(()=>{if(active && initialEntryId)open({id:initialEntryId,item_kind:'entry'});});return()=>{active=false;mounted.current=false;generation.current++;};},[projectId,initialQuery,initialEntryId]);
  async function loadNetwork(){if(networkBusy.current)return;const token=++networkGeneration.current;networkBusy.current=true;setNetworkLoading(true);setNetworkError('');
    try{const result=await api.request('notebook/network',{project_id:projectId,limit:200});
      if(result.project_id!==projectId || !Array.isArray(result.items) || result.items.length>200 || typeof result.truncated!=='boolean' || result.items.some(row=>row.project_id!==projectId || typeof row.id!=='string' || typeof row.title!=='string' || typeof row.body!=='string' || !Array.isArray(row.links)))throw new Error('Notebook network did not match this project.');
      if(mounted.current && token===networkGeneration.current && activeProject.current===projectId)setNetwork(result);
    }catch(error){if(mounted.current && token===networkGeneration.current)setNetworkError(error.message || 'Could not load note connections.');}
    finally{if(token===networkGeneration.current){networkBusy.current=false;setNetworkLoading(false);}}}
  useEffect(()=>{setNetwork(null);setNetworkError('');setShowGraph(false);setEditorMode('write');networkBusy.current=false;return()=>{networkGeneration.current++;};},[projectId]);
  function ensureNetwork(){if(!network)loadNetwork();}
  function insertWiki(id,title){const input=document.querySelector('.notebook-note-body textarea');const start=input?.selectionStart ?? value.body.length,end=input?.selectionEnd ?? start;const text=`[[${id}|${title.replaceAll(']','').replaceAll('|','')}]]`;edit({body:value.body.slice(0,start)+text+value.body.slice(end)});setEditorMode('write');requestAnimationFrame(()=>{input?.focus();input?.setSelectionRange(start+text.length,start+text.length);});}
  function start(useAnchor){setCollection('writing');setShowGraph(false);setEditorMode('write');setState('active');setKind('');setQuery('');load('','',{thoughtType:'',noteState:'active',itemScope:'writing'});setMobileEditor(true);onEntryChange('');selection.current=null;setSelected(null);setCloud(null);setHistory(null);const at=notebookKey(projectId);
    if(drafts.current.has(at)){setMessage('Your unfinished new thought is retained. Save it before starting another.');return;}
    remember({value:newThought(useAnchor || {}),base:null,sent:null,saving:false,error:'',current:null},at);
  }
  async function open(row){
    if(row.item_kind==='passage_note' || row.item_kind==='record_note'){openSource(row.record_id,projectId,row.annotation_id || '',row.document_id || '');return;}
    setShowGraph(false);setEditorMode('write');setMobileEditor(true);onEntryChange(row.id);selection.current=row.id;setSelected(row.id);setCloud(null);setHistory(null);setMessage('');
    const token=++generation.current;
    try{const result=verifyThought(await api.request('notebook/entry',{project_id:projectId,entry_id:row.id}),projectId,row.id);
      if(mounted.current && token===generation.current && selection.current===row.id && activeProject.current===projectId)setCloud(result);}
    catch(error){if(mounted.current && token===generation.current)setMessage(error.message);}
  }
  function edit(patch){const next=draft || {value:notebookMetadata(cloud),base:cloud,sent:null,saving:false,error:'',current:null};remember({...next,value:{...next.value,...patch}});}
  async function save(){if(!draft || busy.current || draft.current || quoteDraft)return;busy.current=true;const at=key,id=selected;
    const row=await saveThought({api,projectId,id,draft,update:value=>remember(value,at)});busy.current=false;
    if(row){clear(at);if(mounted.current && activeProject.current===projectId && selection.current===id){selection.current=row.id;setSelected(row.id);setCloud(row);setHistory(null);setMessage('Note saved.');onEntryChange(row.id);load();if(network)loadNetwork();}}}
  function resolve(choice){const current=draft.current;verifyThought(current,projectId,current.id);clear();selection.current=current.id;setSelected(current.id);setCloud(current);
    if(choice==='draft')remember({...draft,base:current,value:{...draft.value},sent:null,current:null,error:'',saving:false},notebookKey(projectId,current.id));}
  async function revisions(before){try{const page=await api.request('notebook/history',{project_id:projectId,entry_id:selected,limit:10,...(before?{before_revision:before}:{})});
    if(page.items.some(r=>r.snapshot.project_id!==projectId || r.snapshot.id!==selected))throw new Error('History did not match this thought.');
    if(mounted.current && activeProject.current===projectId && selection.current===selected)setHistory(old=>({items:before?[...(old?.items || []),...page.items]:page.items,next:page.next_before_revision}));}catch(error){setMessage(error.message);}}
  async function follow(item){try{
    if(item.kind==='entry'){await open({id:item.id,item_kind:'entry'});return;}
    if(item.kind==='record'){openSource(item.id,projectId,'','');return;}
    const bundle=await api.request('reading/annotation',{project_id:projectId,annotation_id:item.id});
    if(bundle.annotation?.project_id!==projectId || bundle.annotation.id!==item.id || !bundle.anchor?.anchored)throw new Error('Connection did not resolve to its exact saved passage.');
    const document=await api.request('reading/document',{project_id:projectId,document_id:bundle.annotation.document_id});
    if(document.project_id!==projectId || document.id!==bundle.annotation.document_id || document.text_sha256!==bundle.annotation.text_sha256)throw new Error('Connection source document did not match.');
    if(mounted.current && activeProject.current===projectId)openSource(document.source_record_id,projectId,item.id,document.id);
  }catch(error){setMessage(error.message);}}
  const value=draft?.value || (cloud?notebookMetadata(cloud):null),locked=!!draft?.saving || !!draft?.sent || !!quoteDraft;
  const context=selected?cloud:draft?.value;
  async function insertQuote(input){
    if(!value || draft?.saving || draft?.sent || quoteDraft?.saving || quoteBusy.current)return;quoteBusy.current=true;
    const originalId=selected,at=key,quoteAt=quoteKey;
    let pending=quoteDraft;
    try{
      if(!pending){if(value.links.length>=25)throw new Error('This note already has 25 connections. Remove one before adding a citation.');const sent=quoteCapture(projectId,input.document,input.selection);if(value.body.length+quoteMarkdown(sent.exact,input.title,input.document.locator,'urn:research:annotation:'+sent.annotation_uuid).length+2>20000)throw new Error('Shorten this note before inserting a quote.');pending={sent,document:input.document,title:input.title,saving:false,error:''};}
      remember({...pending,saving:true,error:''},quoteAt);
      const response=await api.post('reading/annotations',pending.sent);verifyReadingCapture(response,pending.sent);
      const bundle=await api.request('reading/annotation',{project_id:projectId,annotation_id:response.id});
      if(!bundle.anchor?.anchored)throw new Error('The saved quote needs anchor review.');
      const annotation=verifyReadingCapture(bundle.annotation,pending.sent);
      if(!mounted.current || activeProject.current!==projectId || selection.current!==originalId){remember({...pending,saving:false,error:'The passage was saved. Return to this note and retry to insert its citation.'},quoteAt);return;}
      const markdown=quoteMarkdown(annotation.exact,pending.title,pending.document.locator,annotation.id),body=value.body+(value.body?'\n\n':'')+markdown;
      if(body.length>20000)throw new Error('This note is too long to insert the quote. Your saved passage remains available.');
      const links=value.links.some(link=>link.kind==='annotation'&&link.id===annotation.id)?value.links:[...value.links,{kind:'annotation',id:annotation.id,rationale:('Quoted from '+pending.title+' · '+pending.document.locator).slice(0,2000)}];
      edit({body,links});clear(quoteAt);setEditorMode('write');setMessage('Quote and exact citation inserted. Save your note to keep the change.');
    }catch(error){if(pending)remember({...pending,saving:false,error:error.message || 'Quote save was not confirmed. Retry uses the original passage ID.'},quoteAt);else setMessage(error.message);}finally{quoteBusy.current=false;}
  }
  function exportNote(){if(!cloud)return;const content=`# ${cloud.title}\n\n${cloud.body}\n\n---\nNote: ${cloud.id}\nRevision: ${cloud.revision}\n${cloud.record_id?`Source: ${cloud.record_id}\n`:''}${cloud.document_id?`Edition ID: ${cloud.document_id}\n`:''}${cloud.annotation_id?`Passage: ${cloud.annotation_id}\n`:''}\n${(cloud.links || []).map(item=>`- ${item.kind}: ${item.id} — ${item.rationale}`).join('\n')}\n`;
    const url=URL.createObjectURL(new Blob([content],{type:'text/markdown;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='research-note.md';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  const saveLabel=draft?.saving?'Saving…':draft?.sent?'Retry original notebook save':'Save note';
  return <section className={`research-notebook${sourceTarget&&!showGraph?' has-source-pane':''}${mobileEditor?' is-editing':''}`} aria-label="Research notebook" onKeyDown={event=>{if((event.metaKey || event.ctrlKey)&&event.key.toLowerCase()==='s'){event.preventDefault();if(draft && !locked && !draft.current && value?.title.trim() && value?.body.trim())save();}}}>
    <header className="notebook-heading"><div><span className="notebook-eyebrow">{projectTitle || 'Your space to think'}</span><h2>Notebook</h2><p>Start with an idea. Connect it when you’re ready.</p></div><div className="notebook-heading-actions"><button aria-pressed={showGraph} onClick={()=>{setShowGraph(value=>!value);ensureNetwork();}}>Note graph</button><button className="notebook-new" onClick={()=>start(null)}>New note</button></div></header>
    {networkError && <p role="alert">{networkError} <button onClick={loadNetwork}>Retry note connections</button></p>}
    {showGraph && <><button onClick={()=>setShowGraph(false)}>← Back to notes</button>{networkLoading && <p role="status">Loading saved note connections…</p>}{network && <NotebookNetwork network={network} graph={graph} selected={selected} onOpen={id=>open({id,item_kind:'entry'})} onOpenPassage={id=>follow({kind:'annotation',id})}/>}</>}
    <div className="notebook-with-source"><div className="notebook-layout" hidden={showGraph}>
      <section className="notebook-index" aria-label="Notebook entries"><nav className="notebook-collections" aria-label="Notebook collections">{[['writing','My writing'],['reading','Reading notes'],['all','Everything']].map(([id,label])=><button key={id} aria-pressed={collection===id} onClick={()=>chooseCollection(id)}>{label}</button>)}</nav>
        <form className="notebook-filters" onSubmit={event=>{event.preventDefault();load();}}><label>Search notebook<input value={query} maxLength={300} onChange={event=>setQuery(event.target.value)} placeholder="Find a note…"/></label>
          <details><summary>Filter notes</summary><label>Thought type<select value={kind} onChange={event=>setKind(event.target.value)}><option value="">All thoughts and reading notes</option>{[...thoughtTypes,'passage_note','record_note'].map(type=><option key={type} value={type}>{thoughtLabel(type)}</option>)}</select></label>
          <label>State<select value={state} onChange={event=>setState(event.target.value)}><option value="active">Active</option><option value="withdrawn">Withdrawn thoughts</option></select></label></details><button disabled={loading}>{loading?'Finding…':'Apply filters'}</button></form>
        <div className="notebook-index-label"><h3>Your notes</h3><small>{rows.length}{cursor?'+':''}</small></div>
        {!rows.length && !loading && <p className="notebook-index-empty">No matching entries. New notes will appear here after saving.</p>}
        {rows.map(row=><article key={`${row.item_kind}:${row.id}`} className={row.id===selected?'is-selected':''}><small>{thoughtLabel(row.thought_type)}</small><button className="notebook-title" aria-current={row.id===selected?'page':undefined} onClick={()=>open(row)}>{row.title}</button><p dir="auto">{row.body.slice(0,150)}{row.body.length>150?'…':''}</p>
          {['passage_note','record_note'].includes(row.item_kind) && <small>From your reading · opens alongside</small>}
        </article>)}
        {cursor && <button disabled={loading} onClick={()=>load(cursor)}>More notebook entries</button>}
      </section>
      <section className="notebook-writing" aria-label="Notebook editor">
        <button className="notebook-mobile-back" onClick={()=>setMobileEditor(false)}>← All notes</button>
        <p className="notebook-message" role="status">{message}</p>
        {!value && <div className="notebook-welcome"><span className="notebook-eyebrow">An open page</span><h3>What’s on your mind?</h3><p>A question, a loose idea, a connection you haven’t figured out yet. This is your notebook; a source is optional.</p><button className="notebook-new" onClick={()=>start(null)}>Write your first note</button>{anchor?.record_id && <button onClick={()=>start(anchor)}>New thought at this passage</button>}</div>}
        {value && <>
          <div className="notebook-editor-toolbar"><span role="status">{draft?.current?'Compare revisions':draft?.saving?'Saving…':draft?.sent?'Save needs confirmation':draft?'Unsaved changes':`Saved · revision ${cloud?.revision}`}</span><button className="notebook-save" disabled={!draft || draft.saving || !!draft.current || !!quoteDraft || !value.title.trim() || !value.body.trim()} onClick={save}>{saveLabel}</button></div>
          <div className="notebook-editor-modes" role="group" aria-label="Note editor mode">{['write','preview'].map(mode=><button key={mode} aria-pressed={editorMode===mode} onClick={()=>{setEditorMode(mode);if(mode==='preview')ensureNetwork();}}>{mode==='write'?'Write':'Preview'}</button>)}</div>
          <fieldset disabled={locked} className="notebook-page"><label className="notebook-note-title"><span className="sr-only">Title</span><input aria-label="Note title" value={value.title} maxLength={300} onChange={event=>edit({title:event.target.value})} placeholder="Untitled note" dir="auto"/></label>
            <label className="notebook-note-body" hidden={editorMode!=='write'}><span className="sr-only">Thought (Markdown source)</span><textarea aria-label="Note body" value={value.body} maxLength={20000} rows={10} onChange={event=>edit({body:event.target.value})} placeholder="Start writing. You can connect sources and ideas below." dir="auto"/></label>
            {editorMode==='preview' && !showGraph && <NotebookMarkdown complete={!!network && !network.truncated} body={value.body} notes={network?.items || []} onOpen={id=>open({id,item_kind:'entry'})} onOpenPassage={id=>follow({kind:'annotation',id})}/>}<div className="notebook-page-footer"><small>{value.body.trim()?value.body.trim().split(/\s+/u).length:0} words · Markdown supported</small><label>Thought type<select value={value.thought_type} onChange={event=>edit({thought_type:event.target.value})}>{thoughtTypes.map(type=><option key={type} value={type} disabled={type==='source_claim' && !context?.annotation_id}>{thoughtLabel(type)}</option>)}</select></label></div>
          </fieldset>
          {quoteDraft && <div className="notebook-quote-status" role="status"><p>{quoteDraft.saving?'Saving the exact source passage…':quoteDraft.error}</p>{!quoteDraft.saving && <><button onClick={()=>insertQuote()}>Retry original quote insertion</button><button onClick={()=>clear(quoteKey)}>Keep note without inserting quote</button><small>The source passage may already be saved. This does not delete it.</small></>}</div>}
          <p className="notebook-save-error" role="status">{draft?.error}</p>{draft?.sent && <p>The original request is retained until the outcome is confirmed. Other edits stay locked.</p>}
          {draft?.current && <aside className="notebook-conflict"><h4>Another revision needs comparison</h4><p>Your draft</p><pre>{draft.value.body}</pre><p>Cloud · revision {draft.current.revision} · {draft.current.state}</p><pre>{draft.current.body}</pre><button onClick={()=>resolve('cloud')}>Use cloud thought</button><button onClick={()=>resolve('draft')}>Keep my draft for explicit save</button></aside>}
          <div className="notebook-context">
            <details className="notebook-backlinks" onToggle={event=>{if(event.currentTarget.open)ensureNetwork();}}><summary>Linked notes & backlinks</summary>
              <p>Connections reflect confirmed saves. {network?.truncated?'Only the most recent 200 notes are loaded; title resolution and backlinks may be incomplete.':''}</p>{networkLoading && <p role="status">Loading note links…</p>}
              {network && <><h4>Links from this note</h4>{!graph.edges.some(edge=>edge.from===selected)&&<p>No saved links to other notes yet.</p>}{graph.edges.filter(edge=>edge.from===selected).map((edge,i)=><p key={i}><button onClick={()=>open({id:edge.to,item_kind:'entry'})}>{network.items.find(row=>row.id===edge.to)?.title}</button> · {edge.rationale}</p>)}
              <h4>Notes linking here</h4>{!graph.edges.some(edge=>edge.to===selected)&&<p>No saved backlinks in the loaded notes.</p>}{graph.edges.filter(edge=>edge.to===selected).map((edge,i)=><p key={i}><button onClick={()=>open({id:edge.from,item_kind:'entry'})}>{network.items.find(row=>row.id===edge.from)?.title}</button> · {edge.rationale}</p>)}
              <details><summary>Insert a wiki link</summary><p>Choose a note to insert a stable Markdown link at your cursor. Save to update the graph.</p>{network.items.filter(row=>row.id!==selected).map(row=><button key={row.id} disabled={locked} onClick={()=>insertWiki(row.id,row.title)}>{row.title}</button>)}</details></>}
            </details>
            {context?.record_id && <details className="notebook-source" open><summary>Linked reading</summary>{cloud?.selected_quote && <blockquote dir="auto">{cloud.selected_quote}<footer>{cloud.source_title} · {cloud.edition} · {cloud.locator}</footer></blockquote>}<button onClick={()=>openSource(context.record_id,projectId,context.annotation_id || '',context.document_id || '')}>{inlineSources?'Read linked passage':'Return to anchored source'}</button><p>This note keeps its original source anchor. Add further connections below.</p></details>}
            <details className="notebook-links"><summary>Connections <span>{value.links.length || 'Add a source or idea'}</span></summary><fieldset disabled={locked}><NotebookConnections api={api} projectId={projectId} entryId={selected} links={value.links} onChange={links=>edit({links})} onFollow={follow}/>
              <details className="notebook-manual-link"><summary>Link by ID</summary><label>Connection target type<select value={link.kind} onChange={event=>setLink({...link,kind:event.target.value})}><option value="record">Record</option><option value="annotation">Saved passage</option><option value="entry">Notebook thought</option></select></label><label>Target ID<input value={link.id} maxLength={500} onChange={event=>setLink({...link,id:event.target.value})}/></label><label>Why connect these?<textarea value={link.rationale} maxLength={2000} rows={2} onChange={event=>setLink({...link,rationale:event.target.value})}/></label><button disabled={!link.id.trim() || !link.rationale.trim() || value.links.length>=25} onClick={()=>{edit({links:[...value.links,link]});setLink({kind:'record',id:'',rationale:''});}}>Add explained connection</button></details>
            </fieldset></details>
            <details className="notebook-note-details"><summary>Note details & history</summary><p>{context?.annotation_id?'Anchored to an exact saved passage.':context?.record_id?'Linked to a source record.':'Independent personal note. You can add research connections at any time.'} Private; saving does not publish or verify a claim.</p><fieldset disabled={locked}><label>State<select disabled={!selected} value={value.state} onChange={event=>edit({state:event.target.value})}><option value="active">Active</option><option value="withdrawn">Withdrawn — retain history</option></select></label></fieldset>{selected && <><small>Thought ID: {selected}</small><button onClick={()=>revisions()}>View thought history</button><button onClick={exportNote}>Export saved Markdown</button>{draft && <small>Export contains the last confirmed save.</small>}</>}
              {history && <section aria-label="Thought history">{history.items.map(row=><article key={row.revision}><h4>Revision {row.revision} · {thoughtLabel(row.snapshot.thought_type)} · {row.snapshot.state}</h4><strong>{row.snapshot.title}</strong><pre>{row.snapshot.body}</pre></article>)}{history.next && <button onClick={()=>revisions(history.next)}>Older thought revisions</button>}</section>}
            </details>
          </div>
        </>}
      </section>
    </div>{sourceTarget && <NotebookSourcePane hidden={showGraph} api={api} projectId={projectId} target={sourceTarget} drafts={drafts} changed={changed} noteEditor={noteEditor || localNoteEditor.current} onNavigate={openSource} onClose={()=>{setSourceTarget(null);requestAnimationFrame(()=>{const target=sourceTrigger.current?.isConnected?sourceTrigger.current:window.document.querySelector('.notebook-note-title input');target?.focus({preventScroll:true});});}} onExpand={onOpenSource} onQuote={value&&!locked?input=>insertQuote(input):undefined}/>}</div>
  </section>;
}
