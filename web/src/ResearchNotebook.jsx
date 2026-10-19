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
import {useSurfaceResume} from './surfaceActivity.js';
import {useWritingRecovery,notebookRecoveryPayload,verifyNotebookRecovery} from './useWritingRecovery.js';
import WritingRecovery,{RecoveryStatus} from './WritingRecovery.jsx';
import PrivateTrash,{TrashAction} from './PrivateTrash.jsx';

/** Running project notebook. Passage bodies are a live server projection, never copied here. */
export default function ResearchNotebook({onOpenQuran,api,projectId,drafts,changed=()=>{},onOpenSource,anchor=null,initialQuery='',initialEntryId='',projectTitle='',onEntryChange=()=>{},inlineSources=false,noteEditor=null,initialCollection='all',mode='notes',composeRequest='',onComposeConsumed=()=>{},researchQuestions=[],moreResearchQuestions=null,researchQuestionError=''}){
  const questionMode=mode==='questions', notebookRoot=useRef(null);
  const [rows,setRows]=useState([]),[cursor,setCursor]=useState(null),[query,setQuery]=useState(initialQuery),[kind,setKind]=useState(questionMode?'question':''),[state,setState]=useState('active');
  const [selected,setSelected]=useState(null),[cloud,setCloud]=useState(null),[message,setMessage]=useState(''),[loading,setLoading]=useState(false),[history,setHistory]=useState(null);
  const [collection,setCollection]=useState(initialCollection),[folderOpen,setFolderOpen]=useState(true);
  const searchQuery=useRef(initialQuery);
  function chooseCollection(next){setFolderOpen(true);setCollection(next);setKind(questionMode?'question':'');load('',query,{thoughtType:questionMode?'question':'',noteState:state,itemScope:next});}
  const [sourceTarget,setSourceTarget]=useState(null),sourceTrigger=useRef(null);
  const localNoteEditor=useRef(null);if(!localNoteEditor.current)localNoteEditor.current=new PassageNoteEditor(api,changed);
  function openSource(recordId,targetProject=projectId,annotationId='',documentId='',readingPosition=null){if(targetProject!==projectId)return;if(inlineSources){sourceTrigger.current=window.document.activeElement;setShowGraph(false);setSourceTarget({recordId,annotationId,documentId,readingPosition});}else onOpenSource?.(recordId,targetProject,annotationId,documentId,...(readingPosition!=null?[readingPosition]:[]));}
  const [mobileEditor,setMobileEditor]=useState(false);
  const [editorMode,setEditorMode]=useState('write'),[network,setNetwork]=useState(null),[networkError,setNetworkError]=useState(''),[networkLoading,setNetworkLoading]=useState(false),[showGraph,setShowGraph]=useState(false);
  const networkGeneration=useRef(0),networkBusy=useRef(false),quoteBusy=useRef(false);
  const graph=useMemo(()=>notebookGraph(network?.items || [],{complete:!network?.truncated}),[network]);
  const [link,setLink]=useState({kind:'record',id:'',rationale:''});
  const [,render]=useState(0),generation=useRef(0),listGeneration=useRef(0),mounted=useRef(true),busy=useRef(false),selection=useRef(null),activeProject=useRef(projectId);
  activeProject.current=projectId;
  useSurfaceResume(()=>{load();if(network)loadNetwork();});
  const key=notebookKey(projectId,selected || (questionMode?'new-question':'new')),draft=drafts.current.get(key),quoteKey='notebook-quote:'+key,quoteDraft=drafts.current.get(quoteKey);
  const recoveryPayload=notebookRecoveryPayload(projectId,selected,draft);
  const recovery=useWritingRecovery({api,store:drafts.current,sessionKey:JSON.stringify([key,draft?.base?.revision || 0,draft?.value.request_uuid || '',draft?.recovery?.id || '']),path:'notebook/draft',payload:recoveryPayload,enabled:!!draft,
    identity:draft?.recovery?.id?.slice('urn:research:writing-draft:'.length),revision:draft?.recovery?.revision || 0,verify:verifyNotebookRecovery});
  function remember(value,at=key){drafts.current.set(at,{...value,workspaceMode:mode});changed();render(v=>v+1);}
  function clear(at=key){drafts.current.delete(at);changed();render(v=>v+1);}
  async function load(after='',queryValue=query,{thoughtType=kind,noteState=state,itemScope=collection}={}){
    const token=++listGeneration.current;setLoading(true);setMessage('');
    try{const page=await api.request('notebook/items',{project_id:projectId,q:queryValue,thought_type:thoughtType,state:noteState,item_scope:itemScope,cursor:after,limit:25});
      if(!Array.isArray(page.items) || page.items.some(r=>r.project_id!==projectId))throw new Error('Notebook list did not match this project.');
      if(mounted.current && token===listGeneration.current){setRows(old=>after?[...old,...page.items]:page.items);setCursor(page.next_cursor);}}
    catch(error){if(mounted.current && token===listGeneration.current)setMessage(error.message);}
    finally{if(mounted.current && token===listGeneration.current)setLoading(false);}
  }
  useEffect(()=>{if(searchQuery.current===query)return;const timer=setTimeout(()=>{searchQuery.current=query;load('',query);},250);return()=>clearTimeout(timer);},[query,projectId,kind,state,collection]);
  useEffect(()=>{let active=true;mounted.current=true;selection.current=null;setQuery(initialQuery);setSelected(null);setCloud(null);setRows([]);setHistory(null);load('',initialQuery).then(()=>{if(active && initialEntryId)open({id:initialEntryId,item_kind:'entry'});});return()=>{active=false;mounted.current=false;generation.current++;listGeneration.current++;};},[projectId,initialQuery,initialEntryId]);
  async function loadNetwork(){if(networkBusy.current)return;const token=++networkGeneration.current;networkBusy.current=true;setNetworkLoading(true);setNetworkError('');
    try{const result=await api.request('notebook/network',{project_id:projectId,limit:200});
      if(result.project_id!==projectId || !Array.isArray(result.items) || result.items.length>200 || typeof result.truncated!=='boolean' || result.items.some(row=>row.project_id!==projectId || typeof row.id!=='string' || typeof row.title!=='string' || typeof row.body!=='string' || !Array.isArray(row.links)))throw new Error('Notebook network did not match this project.');
      if(mounted.current && token===networkGeneration.current && activeProject.current===projectId)setNetwork(result);
    }catch(error){if(mounted.current && token===networkGeneration.current)setNetworkError(error.message || 'Could not load note connections.');}
    finally{if(token===networkGeneration.current){networkBusy.current=false;setNetworkLoading(false);}}}
  useEffect(()=>{setNetwork(null);setNetworkError('');setShowGraph(false);setEditorMode('write');networkBusy.current=false;return()=>{networkGeneration.current++;};},[projectId]);
  function ensureNetwork(){if(!network)loadNetwork();}
  function insertWiki(id,title){const input=notebookRoot.current?.querySelector('.notebook-note-body textarea');const start=input?.selectionStart ?? value.body.length,end=input?.selectionEnd ?? start;const text=`[[${id}|${title.replaceAll(']','').replaceAll('|','')}]]`;edit({body:value.body.slice(0,start)+text+value.body.slice(end)});setEditorMode('write');requestAnimationFrame(()=>{input?.focus();input?.setSelectionRange(start+text.length,start+text.length);});}
  function start(useAnchor){setFolderOpen(true);setCollection('writing');setShowGraph(false);setEditorMode('write');setState('active');setKind(questionMode?'question':'');setQuery('');load('','',{thoughtType:questionMode?'question':'',noteState:'active',itemScope:'writing'});setMobileEditor(true);onEntryChange('','');selection.current=null;setSelected(null);setCloud(null);setHistory(null);const at=notebookKey(projectId,questionMode?'new-question':'new');
    if(drafts.current.has(at)){setMessage('Your unfinished new thought is retained. Save it before starting another.');return;}
    const initial=newThought(useAnchor || {});if(questionMode){initial.thought_type='question';initial.body='## Scope\n\n## Working answer\n\n## What remains unclear\n\n## Evidence to investigate\n';}
    remember({value:initial,base:null,sent:null,saving:false,error:'',current:null},at);
  }
  const consumedCompose=useRef('');
  useEffect(()=>{if(composeRequest&&consumedCompose.current!==composeRequest){consumedCompose.current=composeRequest;start(anchor);onComposeConsumed();}},[composeRequest]);
  async function open(row){
    if(row.item_kind==='passage_note' || row.item_kind==='record_note'){openSource(row.record_id,projectId,row.annotation_id || '',row.document_id || '');return;}
    setShowGraph(false);setEditorMode('preview');ensureNetwork();setMobileEditor(true);onEntryChange(row.id,row.title);selection.current=row.id;setSelected(row.id);setCloud(null);setHistory(null);setMessage('');
    const token=++generation.current;
    try{const result=verifyThought(await api.request('notebook/entry',{project_id:projectId,entry_id:row.id}),projectId,row.id);
      if(mounted.current && token===generation.current && selection.current===row.id && activeProject.current===projectId){setCloud(result);onEntryChange(result.id,result.title);}}
    catch(error){if(mounted.current && token===generation.current)setMessage(error.message);}
  }
  function edit(patch){const next=draft || {value:notebookMetadata(cloud),base:cloud,sent:null,saving:false,error:'',current:null};remember({...next,autoSave:Object.keys(patch).every(key=>['title','body'].includes(key)),value:{...next.value,...patch}});if(patch.title!==undefined)onEntryChange(selected || '',patch.title);}
  async function save(automatic=false){if(!draft || busy.current || draft.current || quoteDraft)return;busy.current=true;const at=key,id=selected;
    const row=await saveThought({api,projectId,id,draft:{...draft,autoSaving:automatic},update:next=>{
      const latest=drafts.current.get(at);
      remember({...next,value:latest?.value || next.value,autoSave:latest?.autoSave ?? next.autoSave,autoSaving:!!next.saving&&automatic},at);
    }});busy.current=false;
    if(row){const latest=drafts.current.get(at),continued=latest&&JSON.stringify(notebookMetadata(latest.value))!==JSON.stringify(notebookMetadata(row));
      recovery.queue.finish();clear(at);
      if(continued)remember({...latest,base:row,sent:null,saving:false,autoSaving:false,error:'',current:null,recovery:undefined},notebookKey(projectId,row.id));
      if(mounted.current && activeProject.current===projectId && selection.current===id){selection.current=row.id;setSelected(row.id);setCloud(row);setHistory(null);setMessage('');onEntryChange(row.id,continued?latest.value.title:row.title);load();if(network)loadNetwork();}}}
  function recoverWriting(row,current){
    if(current?.trashed){setMessage('Restore the original note from Trash before recovering its unfinished writing.');return false;}
    const id=row.entry_id || current?.id || null,at=notebookKey(projectId,id || (questionMode?'new-question':'new'));
    if(drafts.current.has(at)){setMessage('Existing unfinished writing is still open. Save or explicitly discard it before recovering another version.');return false;}
    const value={...row.value,...(!id?{request_uuid:row.request_uuid,record_id:row.record_id,document_id:row.document_id,annotation_id:row.annotation_id,...(row.reading_position!=null?{reading_position:row.reading_position}:{})}:{})};
    selection.current=id;setSelected(id);setCloud(current);setShowGraph(false);setMobileEditor(true);setHistory(null);
    remember({value,base:row.base_snapshot || current,sent:null,saving:false,error:'',current:current&&current.revision!==row.base_revision?current:null,recovery:id===(row.entry_id || null)?{id:row.id,revision:row.revision}:undefined},at);
    onEntryChange(id || '',value.title);setMessage('Recovered private writing. Review it before saving the actual note.');return true;
  }
  function resolve(choice){const current=draft.current;verifyThought(current,projectId,current.id);recovery.queue.finish();clear();selection.current=current.id;setSelected(current.id);setCloud(current);
    if(choice==='draft')remember({...draft,base:current,value:{...draft.value},recovery:undefined,sent:null,current:null,error:'',saving:false},notebookKey(projectId,current.id));}
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
  const value=draft?.value || (cloud?notebookMetadata(cloud):null),locked=((!!draft?.saving || !!draft?.sent)&&!draft?.autoSaving) || !!quoteDraft;
  useEffect(()=>{
    if(!draft?.autoSave || draft.saving || draft.sent || draft.current || draft.error || quoteDraft || !value?.title.trim() || !value?.body.trim() || value.thought_type==='source_claim' || value.state!=='active')return;
    const timer=setTimeout(()=>save(true),1500);return()=>clearTimeout(timer);
  },[draft,key,quoteDraft]);
  useEffect(()=>{const input=notebookRoot.current?.querySelector('.notebook-note-body textarea');if(!input || editorMode!=='write')return;
    const resize=()=>{input.style.height='auto';input.style.height=input.scrollHeight+'px';};resize();const observer=new ResizeObserver(resize);observer.observe(input.parentElement);return()=>observer.disconnect();
  },[value?.body,editorMode]);
  function editDocument(){if(locked)return;setEditorMode('write');requestAnimationFrame(()=>notebookRoot.current?.querySelector('.notebook-note-body textarea')?.focus());}
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
  function exportNote(){if(!cloud)return;const content=`# ${cloud.title}\n\n${cloud.body}\n\n---\nNote: ${cloud.id}\nRevision: ${cloud.revision}\n${cloud.record_id?`Source: ${cloud.record_id}\n`:''}${cloud.document_id?`Edition ID: ${cloud.document_id}\n`:''}${cloud.annotation_id?`Passage: ${cloud.annotation_id}\n`:''}${cloud.reading_position!=null?`Approximate reading position (Unicode code points): ${cloud.reading_position}\n`:''}\n${(cloud.links || []).map(item=>`- ${item.kind}: ${item.id} — ${item.rationale}`).join('\n')}\n`;
    const url=URL.createObjectURL(new Blob([content],{type:'text/markdown;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='research-note.md';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  const saveLabel=draft?.saving?'Saving…':draft?.sent?'Retry original notebook save':questionMode?'Save question':'Save note';
  function trashChanged(result){if(cloud?.id===result.target_id)setCloud({...cloud,trashed:result.state==='trashed',trash_revision:result.revision});load();if(network)loadNetwork();}
  function openTrashed(row){if(row.target_kind==='entry')open({id:row.target_id,item_kind:'entry'});else openSource(row.record_id,projectId,row.annotation_id,row.document_id);}
  if(cloud?.trashed&&!draft)return <section className="research-notebook" aria-label="Trashed notebook thought"><h2>This writing is in Trash</h2><p>Its original identity, source links, and revision history remain. Restore it to read or edit it here.</p><TrashAction api={api} projectId={projectId} kind="entry" id={cloud.id} revision={cloud.revision} trashRevision={cloud.trash_revision} trashed onChanged={trashChanged}/><button onClick={()=>{setSelected(null);selection.current=null;setCloud(null);onEntryChange('','');}}>Back to notes</button></section>;
  return <section ref={notebookRoot} className={`research-notebook${sourceTarget&&!showGraph?' has-source-pane':''}${mobileEditor?' is-editing':''}`} aria-label={questionMode?'Research questions':'Research notebook'} onKeyDown={event=>{if((event.metaKey || event.ctrlKey)&&event.key.toLowerCase()==='s'){event.preventDefault();if(draft && !locked && !draft.current && value?.title.trim() && value?.body.trim())save();}}}>
    <header className="notebook-heading"><h2>{questionMode?'Questions':'Notes'}</h2><div className="notebook-heading-actions"><button aria-pressed={showGraph} onClick={()=>{setShowGraph(value=>!value);ensureNetwork();}}>Note graph</button><button className="notebook-new" onClick={()=>start(null)}>{questionMode?'New question':'New note'}</button></div></header>
    {networkError && <p role="alert">{networkError} <button onClick={loadNetwork}>Retry note connections</button></p>}
    {showGraph && <><button onClick={()=>setShowGraph(false)}>← Back to notes</button>{networkLoading && <p role="status">Loading saved note connections…</p>}{network && <NotebookNetwork network={network} graph={graph} selected={selected} onOpen={id=>open({id,item_kind:'entry'})} onOpenPassage={id=>follow({kind:'annotation',id})}/>}</>}
    <div className="notebook-with-source"><div className="notebook-layout" hidden={showGraph}>
      <section className="notebook-index" aria-label="Notebook entries">
        <form className="notebook-filters notebook-search" role="search" aria-label="Search notebook" onSubmit={event=>{event.preventDefault();load();}}><label><span className="sr-only">Search notebook</span><input type="search" value={query} maxLength={300} onChange={event=>{setQuery(event.target.value);setFolderOpen(true);const folder=notebookRoot.current?.querySelector('.notebook-project-folder');if(folder)folder.open=true;}} placeholder="Find a note…"/></label></form>
        <details className="notebook-project-folder" open><summary title={projectTitle || 'Notebook'}><NotebookIcon folder/><span className="notebook-file-title">{projectTitle || 'Notebook'}</span></summary>
          <nav className="notebook-collections" aria-label="Notebook collections">{(questionMode?[['writing','My questions']]:[['writing','My writing'],['reading','Reading notes'],['all','Everything']]).map(([id,label])=><div className="notebook-folder" key={id}>
            <button className="notebook-folder-toggle" aria-pressed={collection===id} aria-expanded={collection===id&&folderOpen} onClick={()=>{if(collection===id)setFolderOpen(!folderOpen);else chooseCollection(id);}}><span className="notebook-chevron" aria-hidden="true" data-expanded={collection===id&&folderOpen}/><NotebookIcon folder/>{label}</button>
            {collection===id&&folderOpen&&<div className="notebook-folder-notes">
              {!rows.length&&!loading&&<p className="notebook-index-empty">No matching entries.</p>}
              {loading&&!rows.length&&<p className="notebook-index-empty" role="status">Loading…</p>}
              {rows.map(row=><article key={`${row.item_kind}:${row.id}`} className={row.id===selected?'is-selected':''}><button className="notebook-title" title={`${row.title} · ${thoughtLabel(row.thought_type)}`} aria-current={row.id===selected?'page':undefined} onClick={()=>open(row)}><NotebookIcon/><span className="notebook-file-title">{row.title}</span></button></article>)}
              {cursor&&<button disabled={loading} onClick={()=>load(cursor)}>More notes</button>}
            </div>}
          </div>)}</nav>
        </details>
        <details className="notebook-tools"><summary>Notebook tools</summary>
          <WritingRecovery api={api} projectId={projectId} onRecover={recoverWriting}/>
          <PrivateTrash api={api} projectId={projectId} onOpen={openTrashed} onChanged={trashChanged}/>
          <form className="notebook-filters" onSubmit={event=>{event.preventDefault();load();}}><details><summary>Filter notes</summary><label>Thought type<select disabled={questionMode} value={kind} onChange={event=>setKind(event.target.value)}><option value="">All thoughts and reading notes</option>{(questionMode?['question']:[...thoughtTypes,'passage_note','record_note']).map(type=><option key={type} value={type}>{thoughtLabel(type)}</option>)}</select></label>
            <label>State<select value={state} onChange={event=>setState(event.target.value)}><option value="active">Active</option><option value="withdrawn">Withdrawn thoughts</option></select></label></details><button disabled={loading}>{loading?'Finding…':'Apply filters'}</button></form>
        </details>
        {questionMode && <section className="notebook-research-questions"><h3>From the research graph</h3><p>Existing research questions retain their recorded review status.</p>{researchQuestionError && <p role="alert">{researchQuestionError}</p>}{researchQuestions.map(row=><article key={row.id}><small>{row.review_state || 'Review not stated'}</small><button className="notebook-title" onClick={()=>openSource(row.id,projectId)}>{row.title}</button><p>{row.summary}</p></article>)}{!researchQuestions.length&&!researchQuestionError&&<p>No graph questions loaded.</p>}{moreResearchQuestions&&<button onClick={moreResearchQuestions}>More graph questions</button>}</section>}
      </section>
      <section className="notebook-writing" aria-label="Notebook editor">
        <button className="notebook-mobile-back" onClick={()=>setMobileEditor(false)}>← All notes</button>
        <p className="notebook-message" role="status">{message}</p>
        {!value && <div className="notebook-welcome"><p>{questionMode?'Choose a question or start a new one.':'Choose a note or start writing.'}</p><button className="notebook-new" onClick={()=>start(null)}>{questionMode?'Write your first question':'Write your first note'}</button>{anchor?.record_id && <button onClick={()=>start(anchor)}>New thought at this passage</button>}</div>}
        {value && <>
          <div className="notebook-editor-toolbar"><span role="status">{draft?.current?'Compare revisions':draft?.saving?'Saving…':draft?.sent?'Save needs confirmation':draft?(!value.title.trim()?'Add a title to save':!value.body.trim()?'Start writing to save':draft.autoSave&&!draft.error&&value.thought_type!=='source_claim'&&value.state==='active'?'Saving shortly…':'Unsaved changes'):`Saved · revision ${cloud?.revision}`}</span><button className="notebook-save" disabled={!draft || draft.saving || !!draft.current || !!quoteDraft || !value.title.trim() || !value.body.trim()} onClick={()=>save()}>{saveLabel}</button></div>
          {draft&&(!draft.autoSave || ['error','conflict'].includes(recovery.status.phase))&&<RecoveryStatus {...recovery}/>}
          <fieldset disabled={locked} className="notebook-page"><label className="notebook-note-title"><span className="sr-only">Title</span>{questionMode?<textarea aria-label="Research question" value={value.title} maxLength={300} rows={2} onChange={event=>edit({title:event.target.value.replaceAll('\n',' ')})} placeholder="What do you want to understand?" dir="auto"/>:<input aria-label="Note title" value={value.title} maxLength={300} onChange={event=>edit({title:event.target.value})} placeholder="Untitled note" dir="auto"/>}</label>
            <label className="notebook-note-body" hidden={editorMode!=='write'}><span className="sr-only">Thought (Markdown source)</span><textarea aria-label={questionMode?'Working answer and research notes':'Note body'} value={value.body} maxLength={20000} rows={10} onChange={event=>edit({body:event.target.value})} onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();setEditorMode('preview');ensureNetwork();requestAnimationFrame(()=>notebookRoot.current?.querySelector('.notebook-document')?.focus());}}} placeholder="Start writing…" dir="auto"/></label>
            {editorMode==='preview' && !showGraph && <div className="notebook-document" tabIndex={0} role="group" aria-label="Note document. Press Enter to edit" onClick={event=>{if(!event.target.closest('button,a,input')&&window.getSelection()?.isCollapsed)editDocument();}} onKeyDown={event=>{if(event.target===event.currentTarget&&event.key==='Enter'){event.preventDefault();editDocument();}}}><NotebookMarkdown complete={!!network && !network.truncated} body={value.body} notes={network?.items || []} onOpen={id=>open({id,item_kind:'entry'})} onOpenPassage={id=>follow({kind:'annotation',id})}/></div>}<div className="notebook-page-footer"><small>{value.body.trim()?value.body.trim().split(/\s+/u).length:0} words · {editorMode==='preview'?'Click text to write':'Markdown · Esc to read'}</small><div className="notebook-editor-modes" role="group" aria-label="Note editor mode">{['write','preview'].map(mode=><button key={mode} aria-pressed={editorMode===mode} onClick={()=>{setEditorMode(mode);if(mode==='preview')ensureNetwork();}}>{mode==='write'?'Write':'Preview'}</button>)}</div><label>Thought type<select value={value.thought_type} onChange={event=>edit({thought_type:event.target.value})}>{thoughtTypes.filter(type=>!questionMode || type==='question' || type===value.thought_type).map(type=><option key={type} value={type} disabled={type==='source_claim' && !context?.annotation_id}>{thoughtLabel(type)}</option>)}</select></label></div>
          </fieldset>
          {quoteDraft && <div className="notebook-quote-status" role="status"><p>{quoteDraft.saving?'Saving the exact source passage…':quoteDraft.error}</p>{!quoteDraft.saving && <><button onClick={()=>insertQuote()}>Retry original quote insertion</button><button onClick={()=>clear(quoteKey)}>Keep note without inserting quote</button><small>The source passage may already be saved. This does not delete it.</small></>}</div>}
          <p className="notebook-save-error" role="status">{draft?.error}</p>{draft?.sent && !draft.saving && <p>The original request is retained until the outcome is confirmed. Other edits stay locked.</p>}
          {draft?.current && <aside className="notebook-conflict"><h4>Another revision needs comparison</h4><p>Your draft</p><pre>{draft.value.body}</pre><p>Cloud · revision {draft.current.revision} · {draft.current.state}</p><pre>{draft.current.body}</pre><button onClick={()=>resolve('cloud')}>Use cloud thought</button><button onClick={()=>resolve('draft')}>Keep my draft for explicit save</button></aside>}
          <div className="notebook-context">
            <details className="notebook-backlinks" onToggle={event=>{if(event.currentTarget.open)ensureNetwork();}}><summary>Linked notes & backlinks</summary>
              <p>Connections reflect confirmed saves. {network?.truncated?'Only the most recent 200 notes are loaded; title resolution and backlinks may be incomplete.':''}</p>{networkLoading && <p role="status">Loading note links…</p>}
              {network && <><h4>Links from this note</h4>{!graph.edges.some(edge=>edge.from===selected)&&<p>No saved links to other notes yet.</p>}{graph.edges.filter(edge=>edge.from===selected).map((edge,i)=><p key={i}><button onClick={()=>open({id:edge.to,item_kind:'entry'})}>{network.items.find(row=>row.id===edge.to)?.title}</button> · {edge.rationale}</p>)}
              <h4>Notes linking here</h4>{!graph.edges.some(edge=>edge.to===selected)&&<p>No saved backlinks in the loaded notes.</p>}{graph.edges.filter(edge=>edge.to===selected).map((edge,i)=><p key={i}><button onClick={()=>open({id:edge.from,item_kind:'entry'})}>{network.items.find(row=>row.id===edge.from)?.title}</button> · {edge.rationale}</p>)}
              <details><summary>Insert a wiki link</summary><p>Choose a note to insert a stable Markdown link at your cursor. Save to update the graph.</p>{network.items.filter(row=>row.id!==selected).map(row=><button key={row.id} disabled={locked} onClick={()=>insertWiki(row.id,row.title)}>{row.title}</button>)}</details></>}
            </details>
            {context?.record_id && <details className="notebook-source" open><summary>Linked reading</summary>{cloud?.selected_quote && <blockquote dir="auto">{cloud.selected_quote}<footer>{cloud.source_title} · {cloud.edition} · {cloud.locator}</footer></blockquote>}{cloud?.quran_context&&onOpenQuran&&<button onClick={()=>{const q=cloud.quran_context;onOpenQuran({chapter:q.chapter||4,ayah_start:q.ayah_start||1,ayah_end:q.ayah_end||1,resource_key:q.resource_key,note_scope:q.note_scope});}}>Read in the Qur’an</button>}<button onClick={()=>openSource(context.record_id,projectId,context.annotation_id || '',context.document_id || '',context.reading_position ?? null)}>{inlineSources?'Read linked passage':'Return to anchored source'}</button><p>This note keeps its original source anchor. Add further connections below.</p></details>}
            <section className="notebook-links"><fieldset disabled={locked}><NotebookConnections api={api} projectId={projectId} entryId={selected} links={value.links} onChange={links=>edit({links})} onFollow={follow}/>
              <details className="notebook-manual-link"><summary>Link by ID</summary><label>Connection target type<select value={link.kind} onChange={event=>setLink({...link,kind:event.target.value})}><option value="record">Record</option><option value="annotation">Saved passage</option><option value="entry">Notebook thought</option></select></label><label>Target ID<input value={link.id} maxLength={500} onChange={event=>setLink({...link,id:event.target.value})}/></label><label>Why connect these?<textarea value={link.rationale} maxLength={2000} rows={2} onChange={event=>setLink({...link,rationale:event.target.value})}/></label><button disabled={!link.id.trim() || !link.rationale.trim() || value.links.length>=25} onClick={()=>{edit({links:[...value.links,link]});setLink({kind:'record',id:'',rationale:''});}}>Add explained connection</button></details>
            </fieldset></section>
            <details className="notebook-note-details"><summary>Note details & history</summary>{draft&&!locked&&!draft.saving&&!draft.sent&&!draft.current&&<button disabled={['error','conflict'].includes(recovery.status.phase)} onClick={()=>{recovery.queue.finish();clear();setMessage('Editor changes discarded. Recovery history remains private.');}}>Discard editor changes</button>}{cloud&&!draft&&<TrashAction api={api} projectId={projectId} kind="entry" id={cloud.id} revision={cloud.revision} trashRevision={cloud.trash_revision} onChanged={trashChanged}/>}<p>{context?.reading_position!=null?'Near an approximate position in the original reading edition.':context?.annotation_id?'Anchored to an exact saved passage.':context?.record_id?'Linked to a source record.':'Independent personal note. You can add research connections at any time.'} Private; saving does not publish or verify a claim.</p><fieldset disabled={locked}><label>State<select disabled={!selected} value={value.state} onChange={event=>edit({state:event.target.value})}><option value="active">Active</option><option value="withdrawn">Withdrawn — retain history</option></select></label></fieldset>{selected && <><small>Thought ID: {selected}</small><button onClick={()=>revisions()}>View thought history</button><button onClick={exportNote}>Export saved Markdown</button>{draft && <small>Export contains the last confirmed save.</small>}</>}
              {history && <section aria-label="Thought history">{history.items.map(row=><article key={row.revision}><h4>Revision {row.revision} · {thoughtLabel(row.snapshot.thought_type)} · {row.snapshot.state}</h4><strong>{row.snapshot.title}</strong><pre>{row.snapshot.body}</pre></article>)}{history.next && <button onClick={()=>revisions(history.next)}>Older thought revisions</button>}</section>}
            </details>
          </div>
        </>}
      </section>
    </div>{sourceTarget && <NotebookSourcePane hidden={showGraph} api={api} projectId={projectId} target={sourceTarget} drafts={drafts} changed={changed} noteEditor={noteEditor || localNoteEditor.current} onNavigate={openSource} onOpenNotebook={row=>open({...row,item_kind:'entry'})} onClose={()=>{setSourceTarget(null);requestAnimationFrame(()=>{const target=sourceTrigger.current?.isConnected?sourceTrigger.current:notebookRoot.current?.querySelector('.notebook-note-title input,.notebook-note-title textarea');target?.focus({preventScroll:true});});}} onExpand={onOpenSource} onQuote={value&&!locked?input=>insertQuote(input):undefined}/>}</div>
  </section>;
}

function NotebookIcon({folder=false}){return <svg className="notebook-file-icon" aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round">{folder?<path d="M3 6h7l2 2h9v11H3z"/>:<><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v5h4M9 12h6M9 16h6"/></>}</svg>;}
