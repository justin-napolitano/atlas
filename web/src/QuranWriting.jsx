import React,{useEffect,useMemo,useRef,useState} from 'react';
import {RecoveryQueue,recoveryFingerprint} from './recoveryQueue.js';
import {recoverySession,useWritingRecovery,notebookRecoveryPayload,verifyNotebookRecovery} from './useWritingRecovery.js';
import {notebookKey,notebookMetadata} from './notebookClient.js';
import NotebookMarkdown from './NotebookMarkdown.jsx';

/** First text atomically creates its versioned reading and note. CAS serializes later typing. */
export default function QuranWriting({api,projectId,context,drafts,changed,onSettled}){
  const key='quran-write:'+JSON.stringify([projectId,context]),store=drafts.current;
  const [value,setValue]=useState(()=>store.get(key)?.body || ''),[editing,setEditing]=useState(true),[,redraw]=useState(0);
  const live=useRef(true),field=useRef(null);
  const [identity]=useState(()=>store.get(key)?.identity || crypto.randomUUID());
  const queue=useMemo(()=>recoverySession(store,key+':'+identity,()=>{
    const q=new RecoveryQueue({identity,write:async sent=>{
      let row;
      if(sent.expected_revision===0){
        const result=await api.post('quran/notes',{project_id:projectId,...context,request_uuid:q.identity,body:sent.body,owner_confirmed:true});
        row=result.note;
        if(result.binding?.resource_key!==context.resource_key||result.binding.reference?.chapter!==context.chapter||result.binding.reference?.ayah_start!==context.ayah_start||result.binding.reference?.ayah_end!==context.ayah_end||row?.record_id!==result.binding.record_id||row?.document_id!==result.binding.document?.id)throw new Error('The note’s reading location was not confirmed.');
        q.binding=result.binding;
      }else{
        row=await api.request('notebook/entry',{}, {project_id:projectId,entry_id:q.row.id,expected_revision:sent.expected_revision,...notebookMetadata(q.row),body:sent.body,owner_confirmed:true});
      }
      if(row?.id!=='urn:research:notebook:'+q.identity||row.project_id!==projectId||row.revision!==sent.expected_revision+1||row.body!==sent.body||row.trashed)throw Object.assign(new Error('The saved note changed elsewhere. Your writing is retained.'),{status:409,current:row});
      q.row=row;return row;
    }});return q;
  }),[store,key]);
  const held=store.get(key),row=queue.row;
  const recovery=useWritingRecovery({api,store,sessionKey:key+':'+(row?.revision||0),path:'notebook/draft',enabled:!!row&&!!held,
    payload:row&&held?notebookRecoveryPayload(projectId,row.id,{base:row,value:{...row,body:value}}):null,verify:verifyNotebookRecovery});
  useEffect(()=>{live.current=true;const unsubscribe=queue.subscribe(status=>{
    const pending=store.get(key);
    if(pending)store.set(key,{...pending,saving:['waiting','saving'].includes(status.phase),error:status.error?.message || '',current:status.current || null});
    if(live.current){redraw(n=>n+1);changed();}
  });return()=>{live.current=false;unsubscribe();};},[queue]);
  useEffect(()=>{const flush=()=>queue.flush();window.addEventListener('pagehide',flush);return()=>window.removeEventListener('pagehide',flush);},[queue]);
  useEffect(()=>{if(field.current){field.current.style.height='auto';field.current.style.height=field.current.scrollHeight+'px';}},[value,editing]);
  function change(body){setValue(body);store.set(key,{body,identity,projectId,workspaceMode:'quran',saving:true});changed();if(body.trim())queue.enqueue({body});}
  async function settle(){setEditing(false);await queue.flush();if(queue.status.phase==='saved'&&queue.row?.body===store.get(key)?.body){
    recovery.queue.finish();store.delete(key);changed();onSettled(queue.row);
  }}
  const phase=queue.status.phase;
  return <article className="quran-writing" onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget))settle();}}>
    {editing?<textarea ref={field} aria-label="Write a verse note" placeholder="Write a note…" value={value} rows={3} onChange={e=>change(e.target.value)}/>:<div className="quran-note-preview" tabIndex={0} onClick={e=>{if(!e.target.closest('a'))setEditing(true);}} onKeyDown={e=>{if(e.key==='Enter')setEditing(true);}}><NotebookMarkdown body={value||'Write a note…'}/></div>}
    {value&&<small role="status">{phase==='saved'?'Saved':phase==='saving'||phase==='waiting'?'Saving…':phase==='idle'?'':'Save not confirmed'}</small>}
    {['error','conflict'].includes(phase)&&<div role="alert"><p>{queue.status.error?.message}</p><button onClick={()=>queue.retry()}>Retry original save</button><pre>{queue.status.current?.body}</pre></div>}
  </article>;
}
