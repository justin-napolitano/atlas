import React,{useEffect,useMemo,useRef,useState} from 'react';
import {newThought,notebookKey,notebookMetadata} from './notebookClient.js';
import {marginWriter} from './marginWriter.js';
import {recoveryFingerprint} from './recoveryQueue.js';
import {recoverySession,useWritingRecovery,notebookRecoveryPayload,verifyNotebookRecovery} from './useWritingRecovery.js';
import {readingPosition,revealReadingPosition} from './readingPosition.js';
import {TrashAction} from './PrivateTrash.jsx';

function MarginWriting({api,record,document,textRoot,drafts,changed,initial,onLeave,onOpenNotebook}){
  const id=initial.id,key=notebookKey(record.project_id,id),store=drafts.current;
  const [,render]=useState(0),alive=useRef(true),input=useRef(null),left=useRef(false),promoted=useRef(false);
  const notify=()=>{changed();if(alive.current)render(n=>n+1);};
  const writer=useMemo(()=>recoverySession(store,'actual-margin:'+key,()=>marginWriter({api,projectId:record.project_id,id,initial,onConfirmed:row=>{
    const draft=store.get(key);if(draft)store.set(key,{...draft,base:row});
  }})),[store,key]);
  const draft=store.get(key),row=writer.row || initial,value=draft?.value || row;
  const recovery=useWritingRecovery({api,store,sessionKey:'margin-recovery:'+JSON.stringify([key,draft?.base?.revision || 0]),path:'notebook/draft',
    payload:notebookRecoveryPayload(record.project_id,draft?.base? id:null,draft),enabled:!!draft,verify:verifyNotebookRecovery});
  const recoveryRef=useRef(recovery.queue);recoveryRef.current=recovery.queue;
  useEffect(()=>{
    alive.current=true;
    function update(status){const held=store.get(key);
      if(status.phase==='saved'&&held&&recoveryFingerprint(notebookMetadata(held.value))===recoveryFingerprint(notebookMetadata(status.row))){store.delete(key);recoveryRef.current.finish();}
      else if(held)store.set(key,{...held,saving:['waiting','saving'].includes(status.phase),error:status.error?.message || '',current:status.current || null});
      notify();
      if(status.phase==='saved'&&left.current&&!promoted.current){promoted.current=true;onLeave?.(status.row);}
    }
    const unsubscribe=writer.subscribe(update);update(writer.status);
    return()=>{alive.current=false;unsubscribe();};
  },[writer]);
  // A confirmed older write changes the recovery baseline. Retire only that old copy.
  useEffect(()=>()=>{if(writer.row&&writer.row.revision>(draft?.base?.revision || 0))recovery.queue.finish();},[recovery.queue]);
  useEffect(()=>{
    if(draft?.value.body.trim()&&!draft.current)writer.enqueue(notebookMetadata(draft.value));
  },[writer,JSON.stringify(draft?.value)]);
  useEffect(()=>{const flush=()=>writer.flush();window.addEventListener('pagehide',flush);return()=>window.removeEventListener('pagehide',flush);},[writer]);
  useEffect(()=>{if(input.current){input.current.style.height='auto';input.current.style.height=input.current.scrollHeight+'px';}},[value.body]);
  function edit(body){
    const current=store.get(key),source=writer.row || initial;
    store.set(key,{...current,value:{...(current?.value || source),body},base:current?.base || writer.row || null,
      workspaceMode:'location-margin',sourceRecordId:record.id,projectId:record.project_id,documentId:document.id});
    notify();
  }
  function blur(event){if(event.currentTarget.contains(event.relatedTarget))return;left.current=true;writer.flush();if(writer.status.phase==='saved'&&!store.has(key)&&!promoted.current){promoted.current=true;onLeave?.(writer.row);}}
  const phase=writer.status.phase,failed=['error','conflict'].includes(phase),saved=writer.row;
  return <article className="location-margin-note" data-margin-note-id={id} onBlur={blur}>
    <div className="location-margin-meta"><button className="location-return" onClick={()=>revealReadingPosition(textRoot.current,value.reading_position)}>Near {Math.round(value.reading_position/Math.max(1,Array.from(document.text_body).length)*100)}% ↖</button>
      <small role="status">{failed?'Not saved':draft?['saving','waiting'].includes(phase)?'Saving…':value.body.trim()?'Unsaved':'Write something to save':saved?'Saved':'Private note'}</small></div>
    <textarea ref={input} aria-label="Margin thought" dir="auto" rows={3} maxLength={20000} placeholder="Write in the margin…" value={value.body}
      onFocus={()=>{left.current=false;}} onChange={event=>edit(event.target.value)} onInput={event=>{event.currentTarget.style.height='auto';event.currentTarget.style.height=event.currentTarget.scrollHeight+'px';}}
      onKeyDown={event=>{if((event.metaKey||event.ctrlKey)&&event.key==='Enter'){event.preventDefault();writer.flush();}}}/>
    {failed&&<div className="location-save-error" role="alert"><p>{writer.status.error?.message || 'Save not confirmed. Your writing is retained here.'}</p><button onClick={()=>writer.retry()}>Retry save</button>
      {writer.status.current&&<details><summary>Compare the other version</summary><pre>{writer.status.current.body}</pre><p>Your version stays in the editor. Open Notes to compare and choose which revision to keep.</p></details>}</div>}
    {draft&&!value.body.trim()&&saved&&<small>Empty writing is retained here; use Trash to remove a saved note.</small>}
    {saved&&<div className="location-note-actions">{onOpenNotebook&&<button onClick={()=>onOpenNotebook(saved)}>Open in Notes</button>}<TrashAction api={api} projectId={record.project_id} kind="entry" id={id} revision={saved.revision} trashRevision={saved.trash_revision || 0} disabled={!!draft} onChanged={result=>onLeave?.({...saved,trashed:result.state==='trashed',trash_revision:result.revision})}/></div>}
  </article>;
}

export default function LocationMarginNotes({api,record,document,textRoot,drafts,changed,composerRef,onOpenNotebook}){
  const [rows,setRows]=useState([]),[cursor,setCursor]=useState(null),[error,setError]=useState(''),[loading,setLoading]=useState(true),[next,setNext]=useState(null);
  const root=useRef(null),position=useRef(null),alive=useRef(true);
  function initialNew(){const pending=[...drafts.current.entries()].find(([key,d])=>key.startsWith('notebook:')&&d.workspaceMode==='location-margin'&&d.documentId===document.id&&d.projectId===record.project_id&&!d.base);
    if(pending){const id=JSON.parse(pending[0].slice(9))[1];return {...pending[1].value,id};}return null;}
  const [fresh,setFresh]=useState(initialNew);
  const valid=row=>row.project_id===record.project_id&&row.record_id===record.id&&row.document_id===document.id&&Number.isInteger(row.reading_position)&&row.reading_position>=0&&row.reading_position<=Array.from(document.text_body).length&&!row.annotation_id&&row.item_kind==='entry';
  async function load(after=''){setLoading(true);try{const page=await api.request('notebook/items',{project_id:record.project_id,document_id:document.id,location_only:true,state:'active',cursor:after,limit:25});
    if(!Array.isArray(page.items))throw new Error();
    if(page.items.some(row=>!valid(row)))throw new Error('Margin notes did not match this reading version.');
    if(alive.current){setRows(old=>[...new Map([...(after?old:[]),...page.items].map(row=>[row.id,row])).values()]);setCursor(page.next_cursor);setError('');}
  }catch(err){if(alive.current)setError(err.message || 'Could not load margin notes.');}finally{if(alive.current)setLoading(false);}}
  useEffect(()=>{alive.current=true;load();return()=>{alive.current=false;};},[document.id]);
  useEffect(()=>{if(composerRef)composerRef.current={focus:()=>root.current?.querySelector('.location-margin-composer textarea')?.focus()};return()=>{if(composerRef)composerRef.current=null;};},[composerRef]);
  function start(body){if(!body)return;const value=newThought({record_id:record.id,document_id:document.id,reading_position:position.current ?? readingPosition(textRoot.current)});
    value.title=('Margin note · '+document.locator).slice(0,300);value.body=body;
    const id='urn:research:notebook:'+value.request_uuid;
    drafts.current.set(notebookKey(record.project_id,id),{value,base:null,workspaceMode:'location-margin',sourceRecordId:record.id,projectId:record.project_id,documentId:document.id});
    setFresh({...value,id});setNext(id);changed();}
  useEffect(()=>{if(next){root.current?.querySelector('.location-margin-composer textarea')?.focus();setNext(null);}},[next]);
  function settle(row){if(!alive.current)return;setRows(old=>[row,...old.filter(r=>r.id!==row.id)]);if(fresh?.id===row.id){setFresh(null);position.current=null;}}
  const shared={api,record,document,textRoot,drafts,changed,onOpenNotebook};
  return <section ref={root} className="location-margin-notes" aria-label="Free margin writing">
    <div className="location-margin-composer">{fresh?<MarginWriting key={fresh.id} {...shared} initial={fresh} onLeave={settle}/>:<textarea aria-label="Write in the margin" dir="auto" placeholder="Write in the margin…" rows={3} onFocus={()=>{position.current=readingPosition(textRoot.current);}} onChange={event=>start(event.target.value)}/>}</div>
    <small className="location-margin-hint">Just your thoughts, saved here as you write. Markdown welcome.</small>
    {loading&&<small role="status">Opening margin notes…</small>}{error&&<p role="alert">{error} <button onClick={()=>load()}>Retry loading</button></p>}
    {rows.filter(row=>row.id!==fresh?.id&&!row.trashed).sort((a,b)=>a.reading_position-b.reading_position).map(row=><MarginWriting key={row.id} {...shared} initial={row} onLeave={settle}/>)}
    {cursor&&<button onClick={()=>load(cursor)}>Earlier margin notes</button>}
  </section>;
}
