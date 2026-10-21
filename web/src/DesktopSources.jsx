import React,{useEffect,useRef,useState} from 'react';
import LiveMarkdownEditor from './LiveMarkdownEditor.jsx';
import {ConnectedWriting} from './connectedWriting.js';
import './desktopSources.css';

export function LocalFileImport({api,recordId=null,onCreated,drafts,changed}){
 const input=useRef(null),pending=useRef(null),[file,setFile]=useState(null),[permitted,setPermitted]=useState(false),[error,setError]=useState(''),[busy,setBusy]=useState(false),[intent,setIntent]=useState('source');
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
   if(!result.artifact_id||result.entry_id==null&&result.record_id==null)throw Error('File save was not confirmed. Retry this exact import.');
   pending.current=null;retain(null);setFile(null);setPermitted(false);if(input.current)input.current.value='';onCreated(result);
  }catch(err){setError(err.message);}finally{setBusy(false);}
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
 const [reference,setReference]=useState(''),[reason,setReason]=useState(''),[candidates,setCandidates]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),pending=useRef(null),key=useRef('reference:'+crypto.randomUUID());
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
   if(!row.record_id)throw Error('Save was not confirmed. Retry this exact reference.');
   pending.current=null;drafts.current.delete(key.current);changed();onCreated(row);
  }catch(err){setError(err.message);}finally{setBusy(false);}
 }
 return <article className="connected-document desktop-add-source"><h1>Add a source</h1><form onSubmit={e=>{e.preventDefault();save();}}>
 <input autoFocus aria-label="Source link, identifier or title" placeholder="Paste a link, DOI, or book title…" value={reference} maxLength={2000} disabled={busy||!!pending.current} onChange={e=>{setReference(e.target.value);setCandidates(null);drafts.current.set(key.current,{workspaceMode:'reference',value:e.target.value});changed();}}/>
 <button disabled={busy||!reference.trim()||!!candidates?.length&&!reason.trim()}>{busy?'Saving…':pending.current?'Retry exact save':'Save reference'}</button></form>
 <p className="desktop-reference-hint">A reference is enough. Add details or a readable copy later.</p>
 {!!candidates?.length&&<section aria-label="Existing reference candidates"><p>Already in your library? Keep its notes and identity.</p>{candidates.map(row=><button key={row.id} disabled={busy} onClick={()=>save(row.id)}>Use {row.title}</button>)}<label>A different edition?<input aria-label="Reason for a distinct edition" value={reason} disabled={busy||!!pending.current} onChange={e=>setReason(e.target.value)} placeholder="What distinguishes this reference?" maxLength={2000}/></label></section>}
 {error&&<p role="alert">{error}</p>}<LocalFileImport api={api} drafts={drafts} changed={changed} onCreated={row=>row.entry_id?onOpenNote(row.entry_id):onCreated(row)}/></article>;
}

const composers=new WeakMap();
export function DesktopSourceWriting({api,record,sessions,changed,onOpen}){
 const [,render]=useState(0),[rows,setRows]=useState([]),[cursor,setCursor]=useState(null),[error,setError]=useState(''),editorState=useRef(new Map());
 if(!composers.has(sessions))composers.set(sessions,new Map());const cache=composers.get(sessions);
 function create(type='note'){
  const session=new ConnectedWriting(api,{anchorValue:{record_id:record.id},value:{title:'',body:'',thought_type:type,links:[],state:'active'},onChanged:changed});
  sessions.set(session.id,session);cache.set(record.id,session);return session;
 }
 const session=cache.get(record.id)||create();
 const revision=session.row?.revision;
 useEffect(()=>{let live=true;api.request('desktop/source/writing',{record_id:record.id,limit:20}).then(page=>{if(live){setRows(page.items);setCursor(page.next_cursor);}}).catch(err=>{if(live)setError(err.message);});return()=>{live=false;};},[record.id,revision]);
 async function more(){try{const page=await api.request('desktop/source/writing',{record_id:record.id,cursor,limit:20});setRows(old=>[...old,...page.items]);setCursor(page.next_cursor);}catch(err){setError(err.message);}}
 return <section className="desktop-source-writing"><header><h2>Your writing</h2><small role="status">{session.saved?'Saved':session.queue.status.phase==='saving'?'Saving…':session.dirty?'Unsaved':''}</small></header>
 <LiveMarkdownEditor value={session.value.body} onChange={body=>{session.edit({body});render(n=>n+1);}} sessionStore={editorState.current} sessionKey={session.id} label="Write beside this source" placeholder="Write a thought or question…"/>
 {['error','conflict'].includes(session.queue.status.phase)&&<div role="alert"><p>{session.queue.status.error?.message||'Your writing is retained. Retry saving.'}</p><button onClick={()=>session.retry()}>Retry exact save</button>{session.queue.status.current&&<><details><summary>Compare the saved version</summary><pre>{session.queue.status.current.body}</pre></details><button onClick={()=>session.resolve('mine')}>Keep my version as a new revision</button><button onClick={()=>session.resolve('cloud')}>Use saved version</button></>}</div>}
 <div className="desktop-writing-actions">{session.row&&<button disabled={!session.saved} onClick={()=>{create();render(n=>n+1);}}>Another note</button>}<button disabled={session.dirty} onClick={()=>{if(session.row)create('question');else session.value.thought_type='question';render(n=>n+1);}}>Write a question</button></div>
 {rows.filter(row=>row.id!==session.id).map(row=><button className="connected-result" key={row.note_key} onClick={()=>onOpen({kind:row.item_kind,id:row.id,origin_project_id:row.origin_project_id})}><span>{row.title||row.locator||'Reading note'}</span><small>{row.thought_type||row.item_kind}{row.locator?' · '+row.locator:''}</small></button>)}
 {cursor&&<button onClick={more}>More writing</button>}{error&&<p role="alert">{error}</p>}</section>;
}
