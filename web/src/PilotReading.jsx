import React,{useEffect,useRef,useState} from 'react';
import {savePilotWrite,verifyPilotImport,verifyPilotResource,verifyVerseRows} from './pilotClient.js';
import './pilotReading.css';

/** Explicitly import attributed pilot verses, then follow located owner links. */
export default function PilotReading({api,projectId,drafts,changed,onOpen,onCancel}) {
  const [resource,setResource]=useState(null),[message,setMessage]=useState(''),[related,setRelated]=useState({}),[cursors,setCursors]=useState({});
  const alive=useRef(true),generation=useRef(0),saving=useRef(new Set());
  useEffect(()=>{
    let active=true;alive.current=true;
    api.request('verses/pilot').then(verifyPilotResource).then(value=>{if(active)setResource(value);}).catch(error=>{if(active)setMessage(error.message);});
    return()=>{active=false;alive.current=false;generation.current++;};
  },[projectId]);
  const key=ayah=>`pilot-import:${JSON.stringify([projectId,4,ayah])}`;
  const form=ayah=>drafts.current.get(key(ayah)) || {request_uuid:crypto.randomUUID(),rationale:'',confirmed:false};
  function update(ayah,value){drafts.current.set(key(ayah),value);changed();}
  async function importVerse(event,verse) {
    event.preventDefault();const ayah=verse.ayah_start,value=form(ayah);
    if(saving.current.has(ayah) || (!value.sent && !value.confirmed))return;
    saving.current.add(ayah);
    const result=await savePilotWrite({api,path:'verses/import-pilot',form:value,payload:{request_uuid:value.request_uuid,project_id:projectId,
      chapter:4,ayah,rationale:value.rationale,owner_confirmed:true},update:next=>update(ayah,next),verify:(receipt,sent)=>verifyPilotImport(api,receipt,sent,resource)});
    saving.current.delete(ayah);
    if(result){drafts.current.delete(key(ayah));changed();if(alive.current)onOpen(result.record_id,result.project_id,result.annotation_id,result.document_id);}
  }
  async function loadRelated(verse,append=false) {
    const token=++generation.current,ayah=verse.ayah_start;setMessage('');
    try {
      const value=await api.request('verses/materials',{project_id:projectId,chapter:4,ayah_start:ayah,ayah_end:ayah,limit:25,...(append && cursors[ayah] ? {cursor:cursors[ayah]} : {})});
      verifyVerseRows(value.items,projectId,4,ayah,ayah);
      if(alive.current && token===generation.current){setRelated(old=>({...old,[ayah]:append ? [...new Map([...(old[ayah] || []),...value.items].map(row=>[row.id,row])).values()] : value.items}));setCursors(old=>({...old,[ayah]:value.next_cursor}));}
    }catch(error){if(alive.current && token===generation.current)setMessage(error.message);}
  }
  return <section className="pilot-reading" aria-labelledby="pilot-reading-heading"><header><div><p className="eyebrow">Bounded reading pilot</p><h2 id="pilot-reading-heading">A verse, its sources, your notes.</h2></div><button onClick={onCancel}>Back to reading</button></header>
    <p>Start with Q 4:59 and Q 4:83. Arabic text, translations, commentary and your own connections retain separate identities. Nothing here is automatically published or marked reviewed.</p>
    {message && <p role="status">{message}</p>}
    {!resource ? <p role="status">{message ? 'Pilot material is unavailable. Reopen this panel to retry.' : 'Loading the identified Arabic resource…'}</p> : <>
      <p><strong>{resource.label}</strong> · {resource.publisher}<br/><a href={resource.attribution_url} target="_blank" rel="noreferrer">Source: Tanzil Project ↗</a></p>
      <p className="pilot-limit">{resource.reading_note}<br/>{resource.review_limit}</p>
      <details className="pilot-notice"><summary>Full source notice & attribution</summary><pre dir="auto">{resource.source_notice}</pre></details>
      <div className="pilot-verses">{resource.verses.map(verse=>{
        const value=form(verse.ayah_start),locked=!!value.sent || !!value.saving,rows=related[verse.ayah_start];
        return <article key={verse.reference.id} data-pilot-ayah={verse.ayah_start}><h3>{verse.reference.label}</h3><p className="pilot-arabic" dir="rtl" lang="ar">{verse.text}</p>
          <form onSubmit={event=>importVerse(event,verse)}><label>Why add this verse to your reading project?<textarea required maxLength={2000} value={value.rationale} disabled={locked} onChange={event=>update(verse.ayah_start,{...value,rationale:event.target.value,confirmed:false})}/></label>
            <label className="pilot-check"><input type="checkbox" checked={value.confirmed} disabled={locked} onChange={event=>update(verse.ayah_start,{...value,confirmed:event.target.checked})}/>Save a private, attributed copy with its source notice. This does not select a translation or approve an interpretation.</label>
            <button disabled={value.saving || (!value.sent && !value.confirmed)}>{value.saving ? 'Saving…' : value.sent ? 'Retry original verse import' : 'Add verse & read'}</button>
            {value.error && <p role="status">{value.error}</p>}</form>
          <button className="pilot-related-load" onClick={()=>loadRelated(verse)}>Show linked reading material</button>
          {rows && <section className="pilot-related" aria-label={`Recorded material for ${verse.reference.label}`}>
            {!rows.some(row=>row.material_kind==='translation') && <p>No translation appears in this loaded page of recorded material.</p>}
            {!rows.some(row=>row.material_kind==='tafsir') && <p>No tafsīr excerpt appears in this loaded page. Coverage is incomplete; absence here is not evidence about the literature.</p>}
            {rows.map(row=><article key={row.id}><small>{row.material_kind.replaceAll('_',' ')} · {row.link_kind.replaceAll('_',' ')} · {row.review_state}</small><h4>{row.attribution}</h4><p>{row.edition} · {row.locator}</p><blockquote dir="auto">{row.selected_quote}</blockquote><p>{row.source_scope}</p>
              {row.citation_changed_needs_review && <p role="status">The underlying citation decision changed; this link needs review.</p>}
              <button onClick={()=>onOpen(row.source_record_id,projectId,row.annotation_id,row.document_id)}>Open exact source passage →</button></article>)}
            {cursors[verse.ayah_start] && <button onClick={()=>loadRelated(verse,true)}>More linked material</button>}
          </section>}
        </article>;
      })}</div>
    </>}
  </section>;
}
