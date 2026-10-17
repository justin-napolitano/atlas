import React,{useEffect,useRef,useState} from 'react';
import {draftRowPayload,recoveryContext,retainedCaptureUUID,saveRecoverableDraft,verifyRecoveredDraft} from './recoverableDraftClient.js';
import './recoverableDraft.css';
import {useWritingRecovery} from './useWritingRecovery.js';
import {RecoveryStatus} from './WritingRecovery.jsx';

/** Explicit private save/recovery alongside an existing editor.
 * @param {{api:object,projectId:string,recordId:string,contextKind:'record_note'|'capture'|'annotation',document?:object,annotation?:object,selection?:object,body:string,markStyle?:string,baseRevision?:number,onRecover:function,drafts?:object,changed?:function}} props
 * @remarks Caller keys this component by source/context, and applies onRecover
 * only to its editor. This component never commits a note, mark or annotation.
 */
export default function RecoverableDraft(props) {
  const {api,projectId,recordId,contextKind,document,annotation,selection,body,markStyle='none',baseRevision=0,onRecover,drafts,changed=()=>{},dirty=false}=props;
  const context=recoveryContext(props),captureUUID=contextKind==='capture' ? retainedCaptureUUID(selection) : null,contextKey=JSON.stringify([context,captureUUID]),key='recoverable:'+JSON.stringify([{...context,base_revision:undefined},captureUUID]);
  const local=useRef(new Map()),store=drafts || local,alive=useRef(true),generation=useRef(0),busy=useRef(false);
  const session=useRef({key:contextKey,uuid:captureUUID || crypto.randomUUID(),revision:0});if(session.current.key!==contextKey)session.current={key:contextKey,uuid:captureUUID || crypto.randomUUID(),revision:0};
  const [rows,setRows]=useState([]),[cursor,setCursor]=useState(null),[state,setState]=useState('active'),[message,setMessage]=useState(''),[loading,setLoading]=useState(false),[preview,setPreview]=useState(null),[history,setHistory]=useState(null),[,render]=useState(0);
  const pending=store.current.get(key);
  const auto=useWritingRecovery({api,store:store.current,sessionKey:'automatic-reading:'+contextKey,path:'reading/draft',
    identity:captureUUID || undefined,
    payload:{...context,body,mark_style:contextKind==='record_note'?'none':markStyle,state:'active'},enabled:dirty,
    verify:(row,sent)=>{verifyRecoveredDraft(row,context);if(row.id!=='urn:research:draft:'+sent.draft_uuid || row.body!==sent.body || row.mark_style!==sent.mark_style || row.state!==sent.state)throw new Error('Recovery did not confirm the exact reading draft.');}});
  const previousAuto=useRef(null);
  useEffect(()=>{if(!dirty && previousAuto.current?.dirty)previousAuto.current.queue.finish();previousAuto.current={dirty,queue:auto.queue};},[dirty,auto.queue]);
  useEffect(()=>{alive.current=true;generation.current++;setRows([]);setPreview(null);setHistory(null);setCursor(null);setMessage('');return()=>{alive.current=false;generation.current++;};},[contextKey]);
  function update(value){store.current.set(key,value);changed();if(alive.current)render(n=>n+1);}
  function clear(){store.current.delete(key);changed();if(alive.current)render(n=>n+1);}
  async function list(append=false,nextState=state){
    const token=++generation.current;setLoading(true);setMessage('');
    try{const value=await api.request('reading/drafts',{project_id:projectId,record_id:recordId,context_kind:contextKind,state:nextState,limit:25,...(document ? {document_id:document.id} : {}),...(annotation ? {annotation_id:annotation.id} : {}),...(append && cursor ? {cursor} : {})});
      value.items.forEach(row=>verifyRecoveredDraft(row,context));if(alive.current && token===generation.current){setRows(old=>append ? [...new Map([...old,...value.items].map(row=>[row.id,row])).values()] : value.items);setCursor(value.next_cursor || null);setState(nextState);}
    }catch(error){if(alive.current && token===generation.current)setMessage(error.message);}finally{if(alive.current && token===generation.current)setLoading(false);}
  }
  async function save(payload,retained=pending){
    if(busy.current)return;busy.current=true;const token=generation.current;
    const row=await saveRecoverableDraft({api,payload,pending:retained,context,update});busy.current=false;
    if(row){clear();if(alive.current && token===generation.current){session.current={key:contextKey,uuid:row.id.slice('urn:research:draft:'.length),revision:row.revision};await list();setMessage(row.state==='discarded' ? 'Draft discarded from the active recovery list. Private revision history is retained.' : 'Draft saved privately across sessions. The actual note is unchanged.');}}
  }
  function saveCurrent(){save({...context,draft_uuid:session.current.uuid,body,mark_style:contextKind==='record_note' ? 'none' : markStyle,state:'active',expected_revision:session.current.revision});}
  async function inspect(row){
    const token=++generation.current;setMessage('');setPreview(null);setHistory(null);
    try{const fresh=verifyRecoveredDraft(await api.request('reading/draft',{project_id:projectId,draft_id:row.id}),context);let current=null;
      if(contextKind==='record_note'){try{current=await api.request('personal-state',{project_id:projectId,record_id:recordId});if(current.project_id!==projectId || current.record_id!==recordId)throw new Error('The current note belongs to another record.');}catch(error){if(error.status===404)current={project_id:projectId,record_id:recordId,note:'',reading:'unread',decision:'unreviewed',revision:0,read_at:null};else throw error;}}
      else if(contextKind==='annotation'){const value=await api.request('reading/annotation',{project_id:projectId,annotation_id:annotation.id});current=value.annotation;if(!value.anchor?.anchored || current.id!==annotation.id || current.project_id!==projectId || current.document_id!==document.id || current.text_sha256!==document.text_sha256)throw new Error('The current passage note could not be verified.');}
      let existingAnnotation=null;
      if(contextKind==='capture'){
        try{const value=await api.request('reading/annotation',{project_id:projectId,annotation_id:'urn:research:annotation:'+fresh.id.slice('urn:research:draft:'.length)});existingAnnotation=value.annotation;
          if(!value.anchor?.anchored || existingAnnotation.project_id!==projectId || existingAnnotation.document_id!==fresh.document_id || existingAnnotation.text_sha256!==fresh.text_sha256 || existingAnnotation.start_pos!==fresh.start_pos || existingAnnotation.end_pos!==fresh.end_pos || existingAnnotation.exact!==fresh.exact)throw new Error('A saved annotation with this capture identity did not match the draft.');current=existingAnnotation;
        }catch(error){if(error.status!==404)throw error;}
      }
      if(alive.current && token===generation.current)setPreview({row:fresh,current,existingAnnotation});
    }catch(error){if(alive.current && token===generation.current)setMessage(error.message);}
  }
  function recover(){const {row,current,existingAnnotation}=preview;const {expected_revision,...recovered}=draftRowPayload(row);try{const applied=onRecover({...recovered,draft_revision:expected_revision,annotation_uuid:contextKind==='capture' ? row.id.slice('urn:research:draft:'.length) : null,base_snapshot:row.base_snapshot,current_snapshot:current,existing_annotation:existingAnnotation});if(applied===false){setMessage('The editor could not apply this draft yet. Your recovery preview remains open; finish any pending save and try again.');return;}setPreview(null);setMessage('Recovered into your editor. Review it before saving the actual note.');}catch{setMessage('The editor could not apply this draft. Your saved copy and recovery preview remain available.');}}
  async function showHistory(row,before=null){const token=++generation.current;try{const value=await api.request('reading/draft-history',{project_id:projectId,draft_id:row.id,limit:25,...(before ? {before_revision:before} : {})});value.items.forEach(item=>{verifyRecoveredDraft(item.snapshot,context);if(item.snapshot.id!==row.id || item.snapshot.revision!==item.revision)throw new Error('History belongs to another draft version.');});if(alive.current && token===generation.current)setHistory(old=>({id:row.id,...value,items:before && old?.id===row.id ? [...old.items,...value.items] : value.items}));}catch(error){if(alive.current && token===generation.current)setMessage(error.message);}}
  function fork(){const sent={...pending.sent,draft_uuid:crypto.randomUUID(),expected_revision:0};save(sent,null);}
  const captureReady=contextKind!=='capture' || (Number.isInteger(context.start) && Number.isInteger(context.end) && context.start>=0 && context.end>context.start && typeof context.exact==='string' && Array.from(context.exact).length===context.end-context.start);
  const changedBaseline=preview?.current && preview.current.revision!==preview.row.base_revision;
  return <section className="recoverable-draft" aria-label="Recoverable private writing">{dirty&&<RecoveryStatus {...auto}/>}<div className="draft-actions"><button disabled={!!pending?.saving || !!pending?.current || (!captureReady && !pending?.sent)} onClick={saveCurrent}>{pending?.saving ? 'Saving draft…' : pending?.sent ? 'Retry original draft save' : 'Save recoverable draft'}</button><button disabled={loading} onClick={()=>list()}>Find saved drafts</button><button disabled={loading} onClick={()=>list(false,state==='active' ? 'discarded' : 'active')}>{state==='active' ? 'Show discarded drafts' : 'Show active drafts'}</button></div>
    <small>Private recovery is separate from saving the actual note. Keep this page open until the recovery copy is confirmed; network loss or closing too early can leave recent keystrokes unprotected.</small>
    {pending?.error && <p role="status">{pending.error}</p>}{message && <p role="status">{message}</p>}{loading && <p role="status">Loading saved drafts…</p>}
    {pending?.current && <div className="draft-conflict"><h4>Cloud draft · revision {pending.current.revision}</h4><pre dir="auto">{pending.current.body}</pre><h4>Your retained draft</h4><pre dir="auto">{pending.sent.body}</pre><button onClick={()=>{clear();inspect(pending.current);}}>Keep cloud draft & inspect</button><button onClick={fork}>Keep both as separate drafts</button></div>}
    {rows.map(row=><article key={row.id}><p>{row.context_kind.replaceAll('_',' ')} · {row.state} · revision {row.revision}{row.locator && ` · ${row.locator}`}</p>{row.exact && <blockquote dir="auto">{row.exact}</blockquote>}<pre dir="auto">{row.body}</pre><div className="draft-actions"><button onClick={()=>inspect(row)}>Inspect & recover</button><button disabled={!!pending?.sent} onClick={()=>save({...draftRowPayload(row),state:row.state==='active' ? 'discarded' : 'active'},null)}>{row.state==='active' ? 'Discard recovery copy' : 'Restore recovery copy'}</button><button onClick={()=>showHistory(row)}>Draft history</button></div></article>)}
    {cursor && <button disabled={loading} onClick={()=>list(true)}>More saved drafts</button>}
    {preview && <div className="draft-preview"><h4>Saved draft · revision {preview.row.revision}</h4><pre dir="auto">{preview.row.body}</pre>{body!==preview.row.body && <><h4>Your current editor · recovery replaces this text</h4><pre dir="auto">{body || '(Empty editor)'}</pre></>}{preview.row.exact && <blockquote dir="auto">{preview.row.exact}</blockquote>}{preview.current && <><h4>Current saved note · revision {preview.current.revision}</h4><pre dir="auto">{preview.current.note ?? preview.current.body}</pre></>}{preview.existingAnnotation && <p>This capture already has a saved annotation. Recover it as an edit to that annotation rather than creating a duplicate.</p>}{changedBaseline && <p role="alert">The saved note changed since this draft began. Compare both versions before recovering; recovery only fills your editor.</p>}<button onClick={recover}>{changedBaseline ? 'Recover after comparing both versions' : 'Recover into editor'}</button><button onClick={()=>setPreview(null)}>Cancel recovery</button></div>}
    {history && <details open><summary>Private draft history</summary>{history.items.map(item=><section key={item.revision}><h4>Revision {item.revision} · {item.snapshot.state}</h4><pre dir="auto">{item.snapshot.body}</pre></section>)}{history.next_before_revision && <button onClick={()=>showHistory({id:history.id},history.next_before_revision)}>Earlier draft revisions</button>}</details>}
    <small>Discard hides the copy from active recovery. Its private history remains; this is not permanent erasure.</small>
  </section>;
}
