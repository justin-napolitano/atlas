import React,{useEffect,useRef,useState} from 'react';
import {verifySearch,searchResultLabel} from './researchSearch.js';
import {notebookConnection} from './notebookConnections.js';

export default function NotebookConnections({api,projectId,links,onChange,onFollow,entryId}){
  const [query,setQuery]=useState(''),[rows,setRows]=useState([]),[target,setTarget]=useState(null),[why,setWhy]=useState(''),[error,setError]=useState(''),[loading,setLoading]=useState(false);
  const generation=useRef(0);
  useEffect(()=>{generation.current++;setRows([]);setTarget(null);setWhy('');setError('');setQuery('');setLoading(false);return()=>{generation.current++;};},[projectId,entryId]);
  async function search(event){event.preventDefault();const token=++generation.current;setLoading(true);setError('');setRows([]);setTarget(null);
    try{const page=verifySearch(await api.request('research/search',{project_id:projectId,q:query.trim(),limit:30}),projectId);
      if(token===generation.current){const seen=new Set();setRows(page.items.filter(row=>{const item=notebookConnection(row);if(!item || item.kind==='entry'&&item.id===entryId)return false;const key=JSON.stringify([item.kind,item.id]);if(seen.has(key))return false;seen.add(key);return true;}));if(page.truncated)setError('First 30 matches shown. Refine your phrase if needed.');}}
    catch(err){if(token===generation.current)setError(err.message || 'Search could not finish.');}
    finally{if(token===generation.current)setLoading(false);}}
  function add(){if(!target || !why.trim())return;const item=notebookConnection(target);if(!item)return;
    if(links.some(link=>link.kind===item.kind&&link.id===item.id)){setError('This connection is already in your note.');return;}
    onChange([...links,{...item,rationale:why.trim()}]);setTarget(null);setWhy('');setRows([]);setQuery('');setError('');}
  return <section className="notebook-connections" aria-label="Note connections">
    <h3>Connections <small>{links.length}</small></h3><p>Bring in a source, concept, passage note, or another note. Say why it belongs.</p>
    {links.map((item,index)=><div className="notebook-connection" key={`${item.kind}:${item.id}`}><p>{item.rationale}</p><button type="button" onClick={()=>onFollow(item)}>Open {item.kind==='entry'?'note':item.kind==='annotation'?'passage':'research item'} ↗</button><button type="button" aria-label={`Remove connection: ${item.rationale}`} onClick={()=>onChange(links.filter((_,i)=>i!==index))}>Remove</button></div>)}
    <form onSubmit={search}><label>Find something to link<input value={query} maxLength={300} onChange={event=>setQuery(event.target.value)} placeholder="A title, word, or idea"/></label><button disabled={loading || !query.trim()}>{loading?'Searching…':'Find connections'}</button></form>
    <p role="status">{error}</p>
    <div className="notebook-connection-results">{rows.map(row=>{const item=notebookConnection(row);return <button type="button" key={`${row.kind}:${row.id}`} aria-pressed={target===row} onClick={()=>{setTarget(row);setWhy('');}}><small>{searchResultLabel(row)}{item.kind==='record'&&row.kind==='document'?' · links the source record':''}</small><strong>{row.title}</strong><span>{row.excerpt.slice(0,150)}</span></button>;})}</div>
    {target && <div className="notebook-connection-confirm"><strong>{target.title}</strong><label>Why connect these?<textarea value={why} maxLength={2000} rows={2} onChange={event=>setWhy(event.target.value)}/></label><button type="button" disabled={!why.trim() || links.length>=25} onClick={add}>Add explained connection</button></div>}
  </section>;
}
