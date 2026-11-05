import React,{useEffect,useRef,useState} from 'react';
import {verifyVerseRows} from './pilotClient.js';

/** Read a bounded page of owner-classified material without inferring coverage. */
export default function VerseMaterialList({api,projectId,reference,onOpen}) {
  const [rows,setRows]=useState([]),[cursor,setCursor]=useState(null),[error,setError]=useState(''),[loading,setLoading]=useState(false);
  const generation=useRef(0),alive=useRef(true);
  const {chapter,ayah_start:start,ayah_end:end}=reference;
  async function load(append=false){
    const token=++generation.current;setLoading(true);setError('');
    try{
      const value=await api.request('verses/materials',{project_id:projectId,chapter,ayah_start:start,ayah_end:end,limit:25,...(append && cursor ? {cursor} : {})});
      verifyVerseRows(value.items,projectId,chapter,start,end);
      if(alive.current && token===generation.current){setRows(old=>append ? [...new Map([...old,...value.items].map(row=>[row.id,row])).values()] : value.items);setCursor(value.next_cursor || null);}
    }catch(err){if(alive.current && token===generation.current)setError(err.message);}
    finally{if(alive.current && token===generation.current)setLoading(false);}
  }
  useEffect(()=>{alive.current=true;setRows([]);setCursor(null);load();return()=>{alive.current=false;generation.current++;};},[projectId,chapter,start,end]);
  return <section className="pilot-related selected-verse-material" aria-label="Selected verse reading material">
    <h3>Q {chapter}:{start}{end!==start ? `–${end}` : ''} · linked reading</h3>
    <p>These are your recorded, located source connections. The verse reference is independent of any edition or translation. Links remain pending review.</p>
    {loading && <p role="status">Loading recorded material…</p>}{error && <p role="alert">{error}</p>}
    {!loading && !error && <>
      {!rows.length && <p>No active material is recorded in this loaded range. You can link a saved source passage from its margin note.</p>}
      {!rows.some(row=>row.material_kind==='translation') && <p>No translation appears in this loaded page.</p>}
      {!rows.some(row=>row.material_kind==='tafsir') && <p>No tafsīr excerpt appears in this loaded page. This does not establish absence from the literature.</p>}
    </>}
    {rows.map(row=><article key={row.id}><small>{row.material_kind.replaceAll('_',' ')} · {row.link_kind.replaceAll('_',' ')} · {row.review_state}</small><h4>{row.attribution}</h4><p>{row.edition} · {row.locator}</p><blockquote dir="auto">{row.selected_quote}</blockquote><p>{row.source_scope}</p>
      {row.assertion_text && <section><strong>{row.assertion_mode==='quotation' ? 'Attributed quotation' : 'Owner-recorded paraphrase'}</strong><p dir="auto">{row.assertion_text}</p></section>}
      {row.citation_changed_needs_review && <p role="status">The underlying citation decision changed; this link needs review.</p>}
      <button onClick={()=>onOpen(row.source_record_id,projectId,row.annotation_id,row.document_id)}>Open exact source passage →</button></article>)}
    {cursor && <button disabled={loading} onClick={()=>load(true)}>More linked material</button>}
    <button disabled={loading} onClick={()=>load()}>Refresh recorded material</button>
  </section>;
}
