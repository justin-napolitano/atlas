import React,{useEffect,useMemo,useRef,useState} from 'react';
import {RecoveryQueue,recoveryFingerprint} from './recoveryQueue.js';
import {recoverySession,useWritingRecovery,notebookRecoveryPayload,verifyNotebookRecovery} from './useWritingRecovery.js';
import {notebookKey,notebookMetadata} from './notebookClient.js';
import NotebookMarkdown from './NotebookMarkdown.jsx';
import {TrashAction} from './PrivateTrash.jsx';

/** First text atomically creates its versioned reading and note. CAS serializes later typing. */
export default function QuranWriting({api,projectId,context,drafts,changed,onSettled,initialNote=null}){
  const key='quran-write:'+JSON.stringify([projectId,context,initialNote?.id||'new']),store=drafts.current;
  const [value,setValue]=useState(()=>store.get(key)?.body ?? initialNote?.body ?? ''),[editing,setEditing]=useState(!initialNote),[,redraw]=useState(0);
  const live=useRef(true),field=useRef(null);
  const [identity]=useState(()=>store.get(key)?.identity || initialNote?.id?.slice('urn:research:notebook:'.length) || crypto.randomUUID());
  const queue=useMemo(()=>recoverySession(store,key+':'+identity,()=>{
    const q=new RecoveryQueue({identity,revision:initialNote?.revision||0,write:async sent=>{
      let row;
      if(sent.expected_revision===0){
        const result=await api.post('quran/notes',{project_id:projectId,...context,request_uuid:q.identity,body:sent.body,owner_confirmed:true});
        row=result.note;
        if(result.binding?.resource_key!==context.resource_key||(context.note_scope!=='source'&&result.binding.reference?.chapter!==context.chapter)||(context.note_scope==='verse'&&(result.binding.reference?.ayah_start!==context.ayah_start||result.binding.reference?.ayah_end!==context.ayah_end))||row?.record_id!==result.binding.record_id||(row?.document_id??null)!==(result.binding.document?.id??null))throw new Error('The note’s reading location was not confirmed.');
        q.binding=result.binding;
      }else{
        row=await api.request('notebook/entry',{}, {project_id:projectId,entry_id:q.row.id,expected_revision:sent.expected_revision,...notebookMetadata(q.row),body:sent.body,owner_confirmed:true});
      }
      if(row?.id!=='urn:research:notebook:'+q.identity||row.project_id!==projectId||row.revision!==sent.expected_revision+1||row.body!==sent.body||row.trashed)throw Object.assign(new Error('The saved note changed elsewhere. Your writing is retained.'),{status:409,current:row});
      q.row=row;return row;
    }});q.row=initialNote;return q;
  }),[store,key]);
  if(initialNote&&!store.has(key)&&!queue.busy&&!queue.sent&&queue.revision<initialNote.revision){queue.row=initialNote;queue.revision=initialNote.revision;}
  const held=store.get(key),row=queue.row;
  const recovery=useWritingRecovery({api,store,sessionKey:key+':'+(row?.revision||0),path:'notebook/draft',enabled:!!held&&(!row||row.body!==value),
    payload:held?notebookRecoveryPayload(projectId,row?.id||null,{base:row||null,value:row?{...row,body:value}:{request_uuid:identity,record_id:null,document_id:null,annotation_id:null,thought_type:'note',title:`Qur’an · ${context.resource_key} · ${context.note_scope} · ${context.chapter}:${context.ayah_start}–${context.ayah_end}`,body:value,links:[],state:'active'}}):null,verify:verifyNotebookRecovery});
  useEffect(()=>()=>{if(queue.row&&queue.row.revision>(row?.revision||0))recovery.queue.finish();},[recovery.queue]);
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
    {editing?<textarea ref={field} aria-label={context.note_scope==='surah'?'Write a surah note':context.note_scope==='source'?'Write a Qur’an note':'Write a verse note'} placeholder="Write a note…" value={value} rows={3} onChange={e=>change(e.target.value)}/>:<div className="quran-note-preview" tabIndex={0} onClick={e=>{if(!e.target.closest('a'))setEditing(true);}} onKeyDown={e=>{if(e.key==='Enter')setEditing(true);}}><NotebookMarkdown body={value||'Write a note…'}/></div>}
    {initialNote&&row&&<TrashAction api={api} projectId={projectId} kind="entry" id={row.id} revision={row.revision} trashRevision={row.trash_revision||0} trashed={!!row.trashed} disabled={!!held} onChanged={()=>onSettled(row)}/>}
    {value&&<small role="status">{phase==='saved'?'Saved':phase==='saving'||phase==='waiting'?'Saving…':phase==='idle'?'':'Save not confirmed'}</small>}
    {['error','conflict'].includes(phase)&&<div role="alert"><p>{queue.status.error?.message}</p><button onClick={()=>queue.retry()}>Retry original save</button><pre>{queue.status.current?.body}</pre></div>}
  </article>;
}
