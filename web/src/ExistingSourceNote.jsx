import React,{useEffect,useRef,useState} from 'react';
import LiveMarkdownEditor from './LiveMarkdownEditor.jsx';
import {ReadingWorkspace} from './workspaceClient.js';
import RecoverableDraft from './RecoverableDraft.jsx';
import {recoverRecordWriting} from './recoverIntoEditor.js';

const stores=new WeakMap();
/** Preserve the old per-record note authority. New writing uses notebook entries. */
export default function ExistingSourceNote({api,record,drafts,changed,focus=false}){
 const [,render]=useState(0),[loaded,setLoaded]=useState(false),[error,setError]=useState(''),alive=useRef(true),root=useRef(null);
 if(!stores.has(drafts.current))stores.set(drafts.current,new ReadingWorkspace(api,changed));
 const store=stores.get(drafts.current),entry=store.entries.get(record.id),key='existing-record-note:'+record.id;
 useEffect(()=>{alive.current=true;if(record.project_id===null){setLoaded(true);return;}
  api.request('personal-state',{project_id:record.project_id,record_id:record.id}).then(row=>{if(alive.current){if(row.record_id!==record.id||row.project_id!==record.project_id)throw new Error('Source note identity changed.');store.adopt(row);setLoaded(true);}}).catch(err=>{if(alive.current){if(err.status!==404)setError(err.message);setLoaded(true);}});return()=>{alive.current=false;};
 },[record.id]);
 useEffect(()=>{if(!entry)return;const dirty=entry.status!=='saved';if(dirty)drafts.current.set(key,{projectId:record.project_id,sourceRecordId:record.id,workspaceMode:'record-note',value:entry.draft,saving:entry.status==='saving',error:entry.status==='error',current:entry.current});else drafts.current.delete(key);},[entry?.status,entry?.draft.note]);
 useEffect(()=>{if(!entry||entry.status!=='unsaved')return;const timer=setTimeout(()=>store.save(record.id),800);return()=>clearTimeout(timer);},[entry?.status,entry?.draft.note]);
 useEffect(()=>{if(focus&&loaded&&entry)root.current?.scrollIntoView({block:'start'});},[focus,loaded]);
 if(!loaded||!entry||!entry.server.note.trim()&&!entry.draft.note.trim())return error?<p role="alert">{error}</p>:null;
 const edit=body=>{store.edit(record.id,{note:body});render(n=>n+1);};
 return <section ref={root} className="connected-document connected-existing-note"><header className="connected-document-tools"><h2>Your source note</h2><small role="status">{entry.status==='saved'?'Saved':entry.status==='saving'?'Saving…':entry.status==='conflict'?'Changed elsewhere':entry.status==='error'?'Save failed':'Unsaved'}</small></header>
 <LiveMarkdownEditor value={entry.draft.note} onChange={edit} sessionStore={drafts.current} sessionKey={key} label="Existing source note" maxLength={10000}/>
 <RecoverableDraft dirty={entry.draft.note!==entry.server.note} api={api} projectId={record.project_id} recordId={record.id} contextKind="record_note" body={entry.draft.note} baseRevision={entry.server.revision} drafts={drafts} changed={changed} onRecover={value=>recoverRecordWriting(store,record,value)}/>
 {entry.status==='error'&&<button onClick={()=>store.save(record.id)}>Retry save</button>}{entry.status==='conflict'&&<div role="alert"><details><summary>Compare the other version</summary><pre>{entry.current.note}</pre></details><button onClick={()=>store.resolve(record.id,'cloud')}>Use the other version</button><button onClick={()=>store.resolve(record.id,'draft')}>Keep my version as a new revision</button></div>}
 </section>;
}
