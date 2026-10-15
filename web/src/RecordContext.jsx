import React,{useEffect,useRef,useState} from 'react';
import {contextProperties,verifyContext} from './readingContext.js';
import './readingContext.css';

const ir='https://islam-research.local/vocab/';
const label=iri=>iri.split(/[\/#]/).pop().replace(/([a-z])([A-Z])/g,'$1 $2');

/** Explicit graph neighbors with direction, provenance, and edition-bound source entry. */
export default function RecordContext({api,record,onOpen,onCompare}){
  const [rows,setRows]=useState([]),[cursor,setCursor]=useState(null),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
  const generation=useRef(0);
  async function load(append=false){const token=++generation.current;setBusy(true);setMessage('');
    try{const value=verifyContext(await api.request('record-context',{project_id:record.project_id,record_id:record.id,limit:25,...(append && cursor ? {cursor} : {})}),record.project_id,record.id);
      if(token===generation.current){setRows(old=>append ? [...old,...value.items] : value.items);setCursor(value.next_cursor);}}
    catch(error){if(token===generation.current)setMessage(error.message);}finally{if(token===generation.current)setBusy(false);}
  }
  useEffect(()=>{setRows([]);setCursor(null);load();return()=>{generation.current++;};},[record.id,record.project_id]);
  return <details className="record-context"><summary>Connections & source context</summary>
    <p>Recorded links retain their direction and evidence. A connection is not a quality score or proof of agreement.</p>
    {message && <p role="alert">{message}</p>}{busy && <p role="status">Loading recorded connections…</p>}
    {!busy && !message && !rows.length && <p>No direct links are recorded here yet. This does not establish absence from the literature.</p>}
    <ul className="context-neighbors">{rows.map(({edge,node,direction,meaning})=><li key={edge.id}>
      <small>{direction==='out' ? 'This record →' : '← This record'} · {label(edge.predicate)} · {edge.review_state}</small>
      <button onClick={()=>onOpen(node.id,record.project_id)}>{node.title}</button><span>{node.kind} · {node.review_state}</span>
      {node.summary && <p>{node.summary}</p>}{contextProperties(node,ir+'locator').map((text,i)=><p key={i}>Location: {text}</p>)}
      <p className="context-meaning">{meaning}</p>
      <details><summary>Relationship basis</summary><pre>{JSON.stringify(edge.provenance,null,2)}</pre><small>{edge.predicate}</small></details>
      {['source','work','edition'].includes(node.kind) && <ContextSource api={api} projectId={record.project_id} record={node} onOpen={onOpen} onCompare={onCompare}/>}
    </li>)}</ul>
    {cursor && <button disabled={busy} onClick={()=>load(true)}>More recorded connections</button>}<button disabled={busy} onClick={()=>load()}>Refresh connections</button>
  </details>;
}

/** Choose an actual saved excerpt; never infer an exact anchor from a citation alone. */
export function ContextSource({api,projectId,record,onOpen,onCompare}){
  const [rows,setRows]=useState(null),[cursor,setCursor]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const generation=useRef(0);useEffect(()=>()=>{generation.current++;},[]);
  async function load(append=false){const token=++generation.current;setBusy(true);setError('');
    try{const value=await api.request('reading/documents',{project_id:projectId,source_record_id:record.id,limit:10,...(append && cursor ? {cursor} : {})});
      if(value.items.some(row=>row.project_id!==projectId || row.source_record_id!==record.id))throw new Error('Saved excerpts did not match this source.');
      if(token===generation.current){setRows(old=>append ? [...old,...value.items] : value.items);setCursor(value.next_cursor);}}
    catch(err){if(token===generation.current)setError(err.message);}finally{if(token===generation.current)setBusy(false);}
  }
  return <div className="context-source">{rows===null ? <button disabled={busy} onClick={()=>load()}>Find saved source excerpts</button> : <>
    {!rows.length && <p>No saved text excerpt is available. Open the source record for its external citation; an exact saved passage is not asserted.</p>}
    {rows.map(row=><div key={row.id}><p>{row.edition} · {row.locator}</p><button onClick={()=>onOpen(record.id,projectId,'',row.id)}>Read this saved version</button>{onCompare && <button onClick={()=>onCompare({record_id:record.id,document_id:row.id})}>Compare this version</button>}</div>)}
    {cursor && <button disabled={busy} onClick={()=>load(true)}>More source excerpts</button>}
  </>}{error && <p role="alert">{error}</p>}</div>;
}
