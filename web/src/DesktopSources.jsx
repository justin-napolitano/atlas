import React,{useContext,useEffect,useRef,useState} from 'react';
import LiveMarkdownEditor from './LiveMarkdownEditor.jsx';
import {ConnectedWriting} from './connectedWriting.js';
import './desktopSources.css';
import {PageLinkContext} from './LocalPages.jsx';
import {pageLinksFor} from './pageLinks.js';
import NotebookMarkdown from './NotebookMarkdown.jsx';

export function LocalFileImport({api,recordId=null,onCreated,drafts,changed}){
 const input=useRef(null),pending=useRef(null),uncertain=useRef(false),[file,setFile]=useState(null),[permitted,setPermitted]=useState(false),[error,setError]=useState(''),[busy,setBusy]=useState(false),[intent,setIntent]=useState('source');
 const key=useRef('local-file:'+crypto.randomUUID());
 function retain(value){if(value)drafts.current.set(key.current,{workspaceMode:'local-file',filename:value.filename,saving:busy,error:!!error});else drafts.current.delete(key.current);changed();}
 async function save(){
  setBusy(true);setError('');
  try{
   if(!pending.current){
    if(!file||!permitted)throw Error('Confirm permission to retain this file.');
    if(!file.size||file.size>32768)throw Error('Choose a UTF-8 Markdown or text file up to 32 KiB.');
    const bytes=new Uint8Array(await file.arrayBuffer());let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);
    pending.current={request_uuid:crypto.randomUUID(),filename:file.name,content_base64:btoa(binary),intent,record_id:recordId,
     rights_basis:'Owner confirms authorship or permission to retain this file privately.',owner_confirmed:true};
   }
   retain(pending.current);const result=await api.post('desktop/files',pending.current);
   if(result.artifact_id!==pending.current.request_uuid||result.entry_id==null&&result.record_id==null||recordId&&result.record_id!==recordId)throw Error('File save was not confirmed. Retry this exact import.');
   pending.current=null;uncertain.current=false;retain(null);setFile(null);setPermitted(false);if(input.current)input.current.value='';onCreated(result);
  }catch(err){if([400,413,415,422].includes(err.status)&&!uncertain.current)pending.current=null;else if(pending.current)uncertain.current=true;setError(err.message);}finally{setBusy(false);}
 }
 return <section className="desktop-file-import"><input hidden ref={input} type="file" accept=".md,.markdown,.txt" aria-label="Choose a local Markdown or text file" onChange={e=>{const next=e.target.files?.[0]||null;setFile(next);setError('');if(next)retain({filename:next.name});else retain(null);}}/>
 {!file&&!pending.current?<button onClick={()=>input.current?.click()}>Add a local file</button>:<><p>{file?.name||pending.current.filename} <small>· UTF-8 text, up to 32 KiB</small></p>
 {!recordId&&<div role="group" aria-label="Import as"><button disabled={busy||!!pending.current} aria-pressed={intent==='source'} onClick={()=>setIntent('source')}>Reading source</button><button disabled={busy||!!pending.current} aria-pressed={intent==='note'} onClick={()=>setIntent('note')}>Editable note</button></div>}
 <label><input type="checkbox" checked={permitted} disabled={busy||!!pending.current} onChange={e=>setPermitted(e.target.checked)}/> This is my writing, or I have permission to keep a private copy.</label>
 <button disabled={busy||!permitted&&!pending.current} onClick={save}>{busy?'Saving locally…':pending.current?'Retry exact import':'Keep locally'}</button>
 {!pending.current&&<button disabled={busy} onClick={()=>{setFile(null);setPermitted(false);retain(null);}}>Cancel</button>}</>}
 {error&&<p role="alert">{error}</p>}</section>;
}

export function DesktopAddSource({api,onCreated,onOpenNote,drafts,changed}){
 const [reference,setReference]=useState(''),[reason,setReason]=useState(''),[candidates,setCandidates]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),pending=useRef(null),uncertain=useRef(false),key=useRef('reference:'+crypto.randomUUID());
 async function save(existing=null){
  if(busy)return;setBusy(true);setError('');
  try{
   if(!pending.current){
    if(!reference.trim())throw Error('Paste a link, identifier or title.');
    if(candidates===null&&!existing){
     const source_url=/^https?:\/\//i.test(reference)?reference:'',identifier=/^(doi:|10\.\d{4,9}\/|https?:\/\/(dx\.)?doi\.org\/)/i.test(reference)?reference:'';
     const found=await api.request('workspace/intake/candidates',{source_url,identifier});setCandidates(found.items);
     if(found.items.length)return;
    }
    pending.current={request_uuid:crypto.randomUUID(),reference:reference.trim(),existing_source_record_id:existing,distinct_reason:reason,owner_confirmed:true};
   }
   const row=await api.post('desktop/references',pending.current);
   if(row.record_id!==(pending.current.existing_source_record_id||'urn:research:source:'+pending.current.request_uuid))throw Error('Save was not confirmed. Retry this exact reference.');
   pending.current=null;uncertain.current=false;drafts.current.delete(key.current);setReference('');setCandidates(null);setReason('');changed();onCreated(row);
  }catch(err){if([400,413,415,422].includes(err.status)&&!uncertain.current){pending.current=null;setCandidates(null);}else if(pending.current)uncertain.current=true;setError(err.message);}finally{setBusy(false);}
 }
 return <article className="connected-document desktop-add-source"><h1>Add a source</h1><form onSubmit={e=>{e.preventDefault();save();}}>
 <input autoFocus aria-label="Source link, identifier or title" placeholder="Paste a link, DOI, or book title…" value={reference} maxLength={2000} disabled={busy||!!pending.current} onChange={e=>{setReference(e.target.value);setCandidates(null);if(e.target.value.trim())drafts.current.set(key.current,{workspaceMode:'reference',value:e.target.value});else drafts.current.delete(key.current);changed();}}/>
 <button disabled={busy||!reference.trim()||!!candidates?.length&&!reason.trim()}>{busy?'Saving…':pending.current?'Retry exact save':'Save reference'}</button></form>
 <p className="desktop-reference-hint">A reference is enough. Add details or a readable copy later.</p>
 {!!candidates?.length&&<section aria-label="Existing reference candidates"><p>Already in your library? Keep its notes and identity.</p>{candidates.map(row=><button key={row.id} disabled={busy} onClick={()=>save(row.id)}>Use {row.title}</button>)}<label>A different edition?<input aria-label="Reason for a distinct edition" value={reason} disabled={busy||!!pending.current} onChange={e=>setReason(e.target.value)} placeholder="What distinguishes this reference?" maxLength={2000}/></label></section>}
 {error&&<p role="alert">{error}</p>}<LocalFileImport api={api} drafts={drafts} changed={changed} onCreated={row=>row.entry_id?onOpenNote(row.entry_id):onCreated(row)}/></article>;
}

const composers=new WeakMap();
export function SourceDetails({api,record,onSaved,drafts,changed}){
 const values=record.attributes?.source_intake||{};
 const [title,setTitle]=useState(record.title),[creators,setCreators]=useState(values.creators||''),[edition,setEdition]=useState(values.edition||''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[current,setCurrent]=useState(null),pending=useRef(null),key='source-details:'+record.id;
 function retain(patch){drafts.current.set(key,{workspaceMode:'source-metadata',...patch});changed();}
 async function save(e){e.preventDefault();setBusy(true);setError('');
  try{pending.current??={request_uuid:crypto.randomUUID(),record_id:record.id,expected_revision:record.revision,title,creators,edition,owner_confirmed:true};const saved=await api.post('desktop/source/metadata',pending.current);if(saved.record_id!==record.id||saved.revision!==pending.current.expected_revision+1)throw Error('Metadata save was not confirmed. Retry this exact save.');pending.current=null;drafts.current.delete(key);changed();onSaved();}
  catch(err){setError(err.message);if(err.status===409&&err.current)setCurrent(err.current);}finally{setBusy(false);}
 }
 return <details className="desktop-source-details"><summary>Bibliography</summary><form onSubmit={save}>
 <label>Title<input value={title} maxLength={2000} disabled={busy||!!pending.current} onChange={e=>{setTitle(e.target.value);retain({title:e.target.value,creators,edition});}}/></label>
 <label>Author or responsible people<input value={creators} maxLength={2000} disabled={busy||!!pending.current} onChange={e=>{setCreators(e.target.value);retain({title,creators:e.target.value,edition});}}/></label>
 <label>Edition, if known<input value={edition} maxLength={1000} disabled={busy||!!pending.current} onChange={e=>{setEdition(e.target.value);retain({title,creators,edition:e.target.value});}}/></label>
 <button disabled={busy||!title.trim()}>{busy?'Saving…':pending.current?'Retry exact metadata save':'Save details'}</button>
 {error&&<p role="alert">{error} Your metadata draft is retained.</p>}{current&&<section><p>Saved revision {current.revision}: {current.title}</p><p>{current.attributes?.source_intake?.creators||'Author unknown'} · {current.attributes?.source_intake?.edition||'Edition unknown'}</p><button type="button" onClick={()=>{pending.current={...pending.current,request_uuid:crypto.randomUUID(),expected_revision:current.revision};setCurrent(null);setError('Reviewed the other revision. Save again to apply your metadata.');}}>Keep my details against this revision</button><button type="button" onClick={()=>{pending.current=null;setTitle(current.title);setCreators(current.attributes?.source_intake?.creators||'');setEdition(current.attributes?.source_intake?.edition||'');setCurrent(null);setError('');drafts.current.delete(key);changed();onSaved();}}>Use saved details</button></section>}</form></details>;
}

export function DesktopSourceWriting({api,record,sessions,changed,onOpen,active=true,onActivate,currentDocumentId=null,refreshKey=0}){
 const pageContext=useContext(PageLinkContext),pageSupport=pageContext.enabled;
 const [,render]=useState(0),[rows,setRows]=useState([]),[cursor,setCursor]=useState(null),[error,setError]=useState(''),editorState=useRef(new Map()),editor=useRef(null),request=useRef(0);
 if(!composers.has(sessions))composers.set(sessions,new Map());const cache=composers.get(sessions);
 function create(type='note'){
  const session=new ConnectedWriting(api,{anchorValue:{record_id:record.id},value:{title:'',body:'',thought_type:type,links:[],state:'active'},onChanged:changed});
  sessions.set(session.id,session);cache.set(record.id,session);return session;
 }
 const session=cache.get(record.id)||(active?create():null),revision=session?.row?.revision;
 useEffect(()=>{let live=true;api.request('desktop/source/writing',{record_id:record.id,limit:20}).then(page=>{if(live){setRows(page.items);setCursor(page.next_cursor);}}).catch(err=>{if(live)setError(err.message);});return()=>{live=false;};},[record.id,revision,refreshKey]);
 useEffect(()=>{if(active&&session)requestAnimationFrame(()=>editor.current?.focus());},[active,session?.id]);
 useEffect(()=>{if(session?.dirty)onActivate?.();},[session?.dirty]);
 async function more(){try{const page=await api.request('desktop/source/writing',{record_id:record.id,cursor,limit:20});setRows(old=>[...new Map([...old,...page.items].map(row=>[row.note_key,row])).values()]);setCursor(page.next_cursor);}catch(err){setError(err.message);}}
 async function editExisting(row){
  if(row.item_kind!=='entry'){onOpen({kind:row.item_kind,id:row.id,origin_project_id:row.origin_project_id});return;}
  if(session?.dirty&&session.id!==row.id){setError('Your unfinished book note is retained. Finish it before opening another editor.');onActivate?.();return;}
  const key=++request.current;try{let selected=sessions.get(row.id);
   if(!selected){const value=await api.request('workspace/note',{entry_id:row.id});if(value.id!==row.id||value.trashed)throw Error('This note is unavailable.');selected=new ConnectedWriting(api,{row:value,onChanged:changed});sessions.set(row.id,selected);}
   if(request.current!==key)return;cache.set(record.id,selected);setError('');onActivate?.();render(n=>n+1);
  }catch(err){setError(err.message);}
 }
 const visible=!!session&&(active||session.dirty),bookRows=rows.filter(row=>!row.document_id&&(!visible||row.id!==session.id)),otherRows=rows.filter(row=>row.document_id&&row.document_id!==currentDocumentId);
 return <section className="desktop-source-writing" aria-label="Book notes"><header><h2>About this source</h2>{visible&&<small role="status">{session.saved?'Saved':session.queue.status.phase==='saving'?'Saving…':session.dirty?'Unsaved':''}</small>}</header>
 {visible&&<><LiveMarkdownEditor ref={editor} value={session.value.body} onChange={(body,detail)=>{session.edit({body,...(pageSupport?{links:pageLinksFor(body,session.value.links,detail?.pageLink,session.pageLinkTargets??=new Set())}:{})});render(n=>n+1);}} pageLinks={pageSupport} sessionStore={editorState.current} sessionKey={session.id} label="Write beside this source" placeholder="Write about the book…"/>
 {['error','conflict'].includes(session.queue.status.phase)&&<div role="alert"><p>{session.queue.status.error?.message||'Your writing is retained. Retry saving.'}</p><button onClick={()=>session.retry()}>Retry exact save</button>{session.queue.status.current&&<><details><summary>Compare the saved version</summary><pre>{session.queue.status.current.body}</pre></details><button onClick={()=>session.resolve('mine')}>Keep my version as a new revision</button><button onClick={()=>session.resolve('cloud')}>Use saved version</button></>}</div>}
 <div className="desktop-writing-actions">{session.row&&<button disabled={!session.saved} onClick={()=>{create();render(n=>n+1);}}>Another note</button>}<button disabled={session.dirty} onClick={()=>{if(session.row)create('question');else session.value.thought_type='question';render(n=>n+1);}}>Write a question</button></div></>}
 {bookRows.map(row=><article className="source-book-note" key={row.note_key}><button className="source-book-note-title" aria-label={'Edit '+(row.title||'book note')} onClick={()=>editExisting(row)}>{row.body?'Edit':row.title||'Book note'}</button>{row.body&&<NotebookMarkdown body={row.body} notes={bookRows} onWikiOpen={pageSupport?pageContext.openWiki:undefined} onOpen={id=>onOpen({kind:'entry',id})}/>}</article>)}
 {otherRows.length>0&&<details className="source-other-notes"><summary>Other reading versions · {otherRows.length}</summary>{otherRows.map(row=><button className="connected-result" key={row.note_key} onClick={()=>onOpen({kind:row.item_kind,id:row.id,origin_project_id:row.origin_project_id})}>{row.title||'Reading note'}</button>)}</details>}
 {cursor&&<button onClick={more}>More writing</button>}{error&&<p role="alert">{error}</p>}</section>;
}
