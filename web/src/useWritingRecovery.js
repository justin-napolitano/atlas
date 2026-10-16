import {useEffect,useMemo,useState} from 'react';
import {RecoveryQueue,recoveryFingerprint} from './recoveryQueue.js';

const sessions=new WeakMap();
export function recoverySession(store,key,create){
  if(!sessions.has(store))sessions.set(store,new Map());
  const map=sessions.get(store);
  if(!map.has(key)){
    const queue=create();map.set(key,queue);
    const unsubscribe=queue.subscribe(status=>{if(status.phase==='saved'&&status.row?.state==='discarded'){if(map.get(key)===queue)map.delete(key);unsubscribe();}});
  }
  return map.get(key);
}
export function useWritingRecovery({api,store,sessionKey,path,payload,enabled=true,identity,revision=0,verify}){
  const queue=useMemo(()=>recoverySession(store,sessionKey,()=>new RecoveryQueue({identity:identity || crypto.randomUUID(),revision,
    write:async sent=>{const row=await api.request(path,{},sent);verify(row,sent);return row;}})),[store,sessionKey]);
  const [status,setStatus]=useState(queue.status),fingerprint=payload?JSON.stringify(payload):'';
  useEffect(()=>{setStatus(queue.status);return queue.subscribe(setStatus);},[queue]);
  useEffect(()=>{if(enabled && payload)queue.enqueue(payload);},[queue,enabled,fingerprint]);
  useEffect(()=>{const flush=()=>queue.flush();window.addEventListener('pagehide',flush);document.addEventListener('visibilitychange',flush);
    return()=>{window.removeEventListener('pagehide',flush);document.removeEventListener('visibilitychange',flush);};},[queue]);
  return {queue,status};
}
export function notebookRecoveryPayload(projectId,id,draft){
  if(!draft)return null;const source=draft.base || draft.value;
  return {project_id:projectId,entry_id:id || null,request_uuid:id?null:draft.value.request_uuid,
    record_id:source.record_id || null,document_id:source.document_id || null,annotation_id:source.annotation_id || null,...(source.reading_position!=null?{reading_position:source.reading_position}:{}),
    base_revision:draft.base?.revision || 0,value:Object.fromEntries(['thought_type','title','body','links','state'].map(k=>[k,draft.value[k]])),state:'active'};
}
export function finishReadingRecovery(store,{projectId,recordId,documentId,annotationId,captureUUID}){
  for(const [key,queue] of sessions.get(store) || []){
    if(!key.startsWith('automatic-reading:'))continue;
    const [context,capture]=JSON.parse(key.slice('automatic-reading:'.length));
    if(context.project_id===projectId&&context.record_id===recordId&&context.document_id===documentId&&
      (captureUUID?context.context_kind==='capture'&&capture===captureUUID:context.context_kind==='annotation'&&context.annotation_id===annotationId))queue.finish();
  }
}
export function verifyNotebookRecovery(row,sent){
  if(row.id!=='urn:research:writing-draft:'+sent.draft_uuid || row.project_id!==sent.project_id ||
    ['entry_id','request_uuid','record_id','document_id','annotation_id','base_revision','state'].some(k=>row[k]!==sent[k]) ||
    (row.reading_position ?? null)!==(sent.reading_position ?? null) || recoveryFingerprint(row.value)!==recoveryFingerprint(sent.value))throw new Error('Recovery did not confirm this exact writing');
}
