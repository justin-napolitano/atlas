import React, { useEffect, useRef, useState } from 'react';

const label = row => `Q ${row.chapter}:${row.ayah_start}${row.ayah_end!==row.ayah_start ? `–${row.ayah_end}` : ''}`;
const formFor = (saved, candidate) => ({
  chapter:String(saved?.chapter ?? candidate?.reference?.chapter ?? ''),
  ayah_start:String(saved?.ayah_start ?? candidate?.reference?.ayah_start ?? ''),
  ayah_end:String(saved?.ayah_end ?? candidate?.reference?.ayah_end ?? ''),
  rationale:saved?.rationale || '', expected_revision:saved?.revision || 0,
});

export default function ScriptureCitations({ annotation,sourceId,api,drafts,changed,navigate }) {
  const [open,setOpen]=useState(false),[data,setData]=useState(null),[message,setMessage]=useState(''),[loading,setLoading]=useState(false);
  const [related,setRelated]=useState(null);
  const alive=useRef(true), generation=useRef(0), relatedGeneration=useRef(0);
  const params={project_id:annotation.project_id,annotation_id:annotation.id};
  const retained=[...drafts.current.values()].some(value=>value.scriptureAnnotationId===annotation.id && value.projectId===annotation.project_id);
  const matches=(row,key)=>row?.project_id===annotation.project_id && row?.annotation_id===annotation.id && row?.candidate_key===key;
  const keyFor=key=>`scripture:${JSON.stringify([annotation.project_id,annotation.id,key])}`;
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;generation.current++;relatedGeneration.current++;};},[]);
  function remember(key,form) {
    drafts.current.set(keyFor(key),{...form,sourceRecordId:sourceId,documentId:annotation.document_id,
      scriptureAnnotationId:annotation.id,projectId:annotation.project_id});changed();
  }
  function forget(key) { drafts.current.delete(keyFor(key));changed(); }
  async function load() {
    const token=++generation.current;setLoading(true);setMessage('');
    try {
      const value=await api.request('reading/scripture-candidates',params);
      if(value.annotation_id!==annotation.id || value.resolutions.some(row=>!matches(row,row.candidate_key))) throw new Error('Reference data did not match this saved passage.');
      if(alive.current && token===generation.current) {setData(value);setOpen(true);}
    } catch(error) {if(alive.current && token===generation.current) setMessage(error.message);}
    finally {if(alive.current && token===generation.current) setLoading(false);}
  }
  async function save(candidate,form,decision) {
    if(form.saving || form.current) return;
    const sent={...params,candidate_key:candidate.key,decision,owner_confirmed:true,
      chapter:decision==='confirmed' ? Number(form.chapter) : null,
      ayah_start:decision==='confirmed' ? Number(form.ayah_start) : null,
      ayah_end:decision==='confirmed' ? Number(form.ayah_end || form.ayah_start) : null,
      rationale:form.rationale,expected_revision:form.expected_revision};
    if(decision==='confirmed') {
      const maximum=data.structure_profile.ayah_counts?.[sent.chapter-1];
      if(!Number.isInteger(sent.chapter) || !Number.isInteger(sent.ayah_start) || !Number.isInteger(sent.ayah_end) ||
        !maximum || sent.ayah_start<1 || sent.ayah_end<sent.ayah_start || sent.ayah_end>maximum) {
        remember(candidate.key,{...form,error:'Choose a valid surah and ayah range for this structure profile.'});return;
      }
    }
    remember(candidate.key,{...form,saving:true,error:''});
    try {
      const row=await api.request('reading/scripture-citation',{},sent);
      if(!matches(row,candidate.key) || row.revision!==sent.expected_revision+1 ||
        ['chapter','ayah_start','ayah_end','decision','rationale'].some(key=>row[key]!==sent[key])) throw new Error('Reference response did not match the saved decision.');
      forget(candidate.key);
      if(alive.current) {
        setData(old=>({...old,resolutions:[...old.resolutions.filter(item=>item.candidate_key!==candidate.key),row]}));
        setRelated(null);setMessage('Reference decision saved to your workspace. Scholarly review is unchanged.');
      }
    } catch(error) {
      remember(candidate.key,{...form,saving:false,error:error.message,current:error.status===409 && matches(error.current,candidate.key) ? error.current : null});
    }
  }
  async function showRelated(row) {
    const token=++relatedGeneration.current;setRelated(null);setMessage('Finding saved passages linked to this verse…');
    try {
      const value=await api.request('reading/scripture-citations',{project_id:annotation.project_id,
        chapter:row.chapter,ayah_start:row.ayah_start,ayah_end:row.ayah_end});
      if(value.items.some(item=>item.project_id!==annotation.project_id)) throw new Error('Related passages did not match this project.');
      if(alive.current && token===relatedGeneration.current) {
        setRelated({...value,label:label(row)});setMessage('');
      }
    } catch(error) {if(alive.current && token===relatedGeneration.current) setMessage(error.message);}
  }
  const saved=new Map((data?.resolutions || []).map(row=>[row.candidate_key,row]));
  const candidates=[...(data?.candidates || [])];
  for(const row of saved.values()) if(row.candidate_key!=='manual' && !candidates.some(item=>item.key===row.candidate_key)) {
    candidates.push({key:row.candidate_key,matched_text:row.matched_text,status:'saved_previous_parser',reason:'Saved reference from an earlier detector version.'});
  }
  candidates.push({key:'manual',detector_kind:'owner_mapping'});
  return <section className="scripture-citations" aria-label="Qur’an references for this passage">
    <button className="scripture-toggle" aria-expanded={open} disabled={loading} onClick={()=>{if(open)setOpen(false);else load();}}>{loading ? 'Checking references…' : open ? 'Hide Qur’an references' : 'Link Qur’an references'}{retained && ' · unsaved decision'}</button>
    {open && data && <>
      <p>Confirm an explicit citation or add your own connection. Connections remain private and unreviewed.</p>
      {!data.candidates.length && <p>No explicit references detected in this selected passage. You can map one below.</p>}
      {candidates.map(candidate=>{
        const row=saved.get(candidate.key),draft=drafts.current.get(keyFor(candidate.key)),form=draft || formFor(row,candidate);
        const edit=patch=>remember(candidate.key,{...form,...patch});
        return <div key={candidate.key} className="scripture-reference" data-candidate-key={candidate.key}>
          <h5>{candidate.key==='manual' ? 'My connection to a verse' : candidate.reference?.label || 'Reference to resolve'}</h5>
          {candidate.matched_text && <p className="scripture-marker">Found: <q>{candidate.matched_text}</q> · {candidate.detector_kind?.replaceAll('_',' ')}</p>}
          {candidate.key==='manual' ? <p>Owner mapping. This does not assert that the source explicitly cites this verse.</p> : !row && <p>{candidate.reason}</p>}
          {row && <div className="scripture-saved"><strong>{row.decision==='confirmed' ? `Linked to ${label(row)}` : 'Dismissed'} · revision {row.revision}</strong>
            <p>{row.rationale}</p>{row.decision==='confirmed' && <div>
              <a href={`https://quran.com/${row.chapter}/${row.ayah_start}`} target="_blank" rel="noreferrer">Open {row.ayah_start===row.ayah_end ? 'verse' : 'first verse'} ↗</a>
              <button onClick={()=>showRelated(row)}>Find linked passages</button>
            </div>}</div>}
          <details open={!!draft || (!row && candidate.key!=='manual')} className="scripture-form"><summary>{row ? 'Edit reference decision' : candidate.key==='manual' ? 'Add a verse connection' : 'Resolve reference'}</summary>
            <fieldset disabled={!!form.saving}><legend>{candidate.key==='manual' ? 'Connect this selected passage' : 'Resolve the cited reference'}</legend>
              <div className="scripture-positions">{[['chapter','Surah',114],['ayah_start','First ayah',286],['ayah_end','Last ayah',286]].map(([name,title,max])=>
                <label key={name}>{title}<input type="number" min="1" max={max} value={form[name]} onChange={event=>edit({[name]:event.target.value})} /></label>)}</div>
              <label>Why this decision?<textarea maxLength={2000} rows={2} value={form.rationale} onChange={event=>edit({rationale:event.target.value})} /></label>
              {form.current && <div className="scripture-conflict" role="alert"><p>Changed on another device. Cloud revision {form.current.revision}: {form.current.decision==='confirmed' ? label(form.current) : 'Dismissed'}.</p><p>{form.current.rationale}</p>
                <button onClick={()=>{setData(old=>({...old,resolutions:[...old.resolutions.filter(item=>item.candidate_key!==candidate.key),form.current]}));forget(candidate.key);}}>Use cloud decision</button>
                <button onClick={()=>edit({expected_revision:form.current.revision,current:null,error:''})}>Keep my draft against this revision</button></div>}
              {form.error && <p role="alert">{form.error} Your draft is still here.</p>}
              <div className="scripture-actions">
                <button className="scripture-confirm" disabled={!!form.current || !form.chapter || !form.ayah_start || !form.rationale.trim()} onClick={()=>save(candidate,form,'confirmed')}>{form.saving ? 'Saving…' : 'Confirm reference'}</button>
                <button className="scripture-dismiss" disabled={!!form.current || !form.rationale.trim()} onClick={()=>save(candidate,form,'dismissed')}>Dismiss reference</button>
                {draft && <button onClick={()=>forget(candidate.key)}>Discard draft</button>}
              </div>
            </fieldset>
          </details>
        </div>;
      })}
      <small>Bounds: {data.structure_profile.profile_id}. No edition, translation, commentary coverage, or interpretation is verified by this check.</small>
      <button className="scripture-refresh" disabled={loading} onClick={load}>Refresh saved decisions</button>
      {related && <div className="scripture-related"><h5>Passages linked to {related.label}</h5>{!related.items.length && <p>No confirmed connections in this project.</p>}
        {related.items.map(row=><article key={row.id}><button onClick={()=>navigate(row.source_record_id,row.project_id,row.annotation_id)}>{row.source_title}</button><p>{row.edition} · {row.locator}</p><blockquote>{row.selected_quote}</blockquote><small>{row.detector_kind==='owner_mapping' ? 'Owner mapping' : 'Owner-resolved citation'} · interpretation unreviewed</small></article>)}
        {related.next_cursor && <p>Showing the first 25 connections. Use a narrower verse range for more focused results.</p>}
      </div>}
    </>}
    {message && <p role="status">{message}</p>}
  </section>;
}
