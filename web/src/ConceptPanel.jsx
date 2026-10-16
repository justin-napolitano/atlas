import React,{useEffect,useRef,useState} from 'react';
import {appendLexicalPage,definitionKinds,exportLexiconDraft,lexicalKey} from './lexiconClient.js';
import './lexicon.css';
import {useSurfaceResume} from './surfaceActivity.js';

const fields=['body','attribution','scope','dating_note','rationale','wording_mode'];
const values=row=>Object.fromEntries(fields.map(key=>[key,row[key]]));
const same=(a,b)=>fields.every(key=>a[key]===b[key]);
export default function ConceptPanel({record,api,drafts,changed,navigate}) {
  const [data,setData]=useState(null),[error,setError]=useState(''),[loading,setLoading]=useState(false);
  const [history,setHistory]=useState(new Map());
  const alive=useRef(true),generation=useRef(0);
  const params={project_id:record.project_id,concept_id:record.id};
  useSurfaceResume(load);
  useEffect(()=>{alive.current=true;load();return()=>{alive.current=false;generation.current++;};},[record.id,record.project_id]);
  async function load() {
    const token=++generation.current;setLoading(true);setError('');
    try {
      const [concept,definitions,occurrences,senses]=await Promise.all([
        api.request('lexicon/concept',params),api.request('lexicon/definitions',params),
        api.request('lexicon/occurrences',params),api.request('lexicon/senses',params)]);
      if(concept.concept.id!==record.id || concept.concept.project_id!==record.project_id ||
        [definitions,occurrences,senses].some(list=>list.items.some(row=>row.project_id!==record.project_id || (row.concept_id && row.concept_id!==record.id)))) throw new Error('Concept data did not match this project.');
      if(alive.current && token===generation.current) setData({concept,definitions,occurrences,senses});
    } catch(error) {if(alive.current && token===generation.current)setError(error.message);}
    finally {if(alive.current && token===generation.current)setLoading(false);}
  }
  async function more(kind) {
    const token=generation.current,after=data[kind].next_cursor;if(!after)return;
    try {
      const value=await api.request('lexicon/'+kind,{...params,cursor:after});
      if(value.items.some(row=>row.project_id!==record.project_id || (row.concept_id && row.concept_id!==record.id))) throw new Error('Concept page did not match this project.');
      if(alive.current && token===generation.current)setData(old=>({...old,[kind]:{items:appendLexicalPage(old[kind].items,value.items),next_cursor:value.next_cursor}}));
    } catch(error) {if(alive.current && token===generation.current)setError(error.message);}
  }
  async function refreshGap() {
    const token=generation.current;
    try {
      const value=await api.request('lexicon/concept',params);
      if(value.concept.id!==record.id || value.concept.project_id!==record.project_id)throw new Error('Concept coverage did not match this project.');
      if(alive.current && token===generation.current)setData(old=>old ? {...old,concept:value} : old);
    } catch(error){if(alive.current && token===generation.current)setError(error.message);}
  }
  function edit(row,patch) {
    const key=lexicalKey(record.project_id,row.id,'definition-edit'),current=drafts.current.get(key);
    if(current?.saving)return;
    drafts.current.set(key,{...current,form:{...(current?.form || values(row)),...patch},expected_revision:current?.expected_revision || row.revision,
      server:current?.server || row,sourceRecordId:row.source_record_id,documentId:row.document_id});changed();
  }
  async function save(row) {
    const key=lexicalKey(record.project_id,row.id,'definition-edit'),draft=drafts.current.get(key);
    if(!draft || draft.saving || draft.current)return;
    if(draft.form.wording_mode==='quotation' && draft.form.body!==row.source_quotation) {setError('A quotation must match the captured source exactly. Choose paraphrase for edited wording.');return;}
    const sent={...draft.form,project_id:record.project_id,definition_id:row.id,expected_revision:draft.expected_revision,state:row.state,owner_confirmed:true};
    drafts.current.set(key,{...draft,saving:true,error:''});changed();
    try {
      const value=await api.request('lexicon/definition',{},sent);
      if(value.id!==row.id || value.project_id!==record.project_id || value.annotation_id!==row.annotation_id || value.concept_id!==record.id || !same(value,sent) || value.revision!==sent.expected_revision+1) throw new Error('Definition response did not match this correction.');
      drafts.current.delete(key);changed();
      if(alive.current)setData(old=>({...old,definitions:{...old.definitions,items:old.definitions.items.map(item=>item.id===row.id ? {...item,...value} : item)}}));
      if(value.state!=='active')refreshGap();
    } catch(error) {
      const current=error.status===409 && error.current?.id===row.id && error.current?.project_id===record.project_id && error.current?.concept_id===record.id && error.current?.annotation_id===row.annotation_id ? error.current : null;
      drafts.current.set(key,{...draft,saving:false,current,error:error.message});changed();
    }
  }
  async function showHistory(row,append=false) {
    const previous=history.get(row.id);
    try {
      const value=await api.request('lexicon/history',{project_id:record.project_id,entity_kind:'definition',entity_id:row.id,
        ...(append && previous?.next_before_revision ? {before_revision:previous.next_before_revision} : {})});
      if(value.items.some(item=>item.entity_id!==row.id || item.snapshot.project_id!==record.project_id)) throw new Error('Definition history did not match this project.');
      if(alive.current)setHistory(old=>new Map(old).set(row.id,{items:append ? [...(previous?.items || []),...value.items] : value.items,next_before_revision:value.next_before_revision}));
    } catch(error) {if(alive.current)setError(error.message);}
  }
  function resolve(row,choice) {
    const key=lexicalKey(record.project_id,row.id,'definition-edit'),draft=drafts.current.get(key);
    if(!draft?.current)return;
    const current=draft.current;
    setData(old=>({...old,definitions:{...old.definitions,items:old.definitions.items.map(item=>item.id===row.id ? {...item,...current} : item)}}));
    if(choice==='cloud')drafts.current.delete(key);
    else drafts.current.set(key,{...draft,server:current,expected_revision:current.revision,current:null,error:''});
    if(current.state!=='active'){setError('The cloud assertion is withdrawn. A correction will retain that state.');refreshGap();}
    changed();
  }
  function definition(row) {
    const key=lexicalKey(record.project_id,row.id,'definition-edit'),draft=drafts.current.get(key);
    const versions=history.get(row.id);
    return <article className="concept-definition" key={row.id}>
      <small>{definitionKinds[row.definition_kind]} · {row.wording_mode} · {row.review_state}{row.state!=='active' && ` · ${row.state}`} · revision {row.revision}</small>
      {row.wording_mode==='quotation' ? <blockquote dir="auto">{row.body}</blockquote> : <p className="concept-definition-text" dir="auto">{row.body}</p>}
      <p><strong>{row.attribution}</strong> · {row.scope}</p>{row.dating_note && <p>{row.dating_note}</p>}
      {row.definition_kind==='machine_proposed' && <p>Declared proposal: {row.proposal_tool} · {row.proposal_version} · {row.proposal_activity}</p>}
      <button className="concept-source" onClick={()=>navigate(row.source_record_id,record.project_id,row.annotation_id)}>{row.source_title} →</button>
      <small>{row.edition} · {row.locator}</small>
      <details><summary>Located source wording</summary><blockquote dir="auto">{row.source_quotation}</blockquote><p>{row.rationale}</p></details>
      {draft ? <div className="concept-definition-edit"><fieldset disabled={!!draft.saving}>
        <label>Wording<select value={draft.form.wording_mode} onChange={event=>edit(row,{wording_mode:event.target.value})}><option value="quotation">Exact captured quotation</option><option value="paraphrase">Paraphrase</option></select></label>
        <label>Definition text<textarea className="concept-edit-body" rows={4} maxLength={5000} value={draft.form.body} onChange={event=>edit(row,{body:event.target.value})} /></label>
        {fields.filter(name=>!['body','wording_mode'].includes(name)).map(name=><label key={name}>{({attribution:'Who says this?',scope:'Scope',dating_note:'Dating uncertainty',rationale:'Why this correction?'})[name]}
          <textarea className={'concept-edit-'+name} rows={2} maxLength={name==='scope' ? 10000 : 2000} value={draft.form[name]} onChange={event=>edit(row,{[name]:event.target.value})} /></label>)}
        {draft.current && <div className="concept-definition-conflict" role="alert"><p>Changed on another device. Cloud revision {draft.current.revision} · {draft.current.state}:</p><small>{definitionKinds[draft.current.definition_kind]} · {draft.current.wording_mode} · {draft.current.dating_note || 'No dating recorded'}</small><pre>{draft.current.body}</pre><p>{draft.current.attribution} · {draft.current.scope}</p><p>{draft.current.rationale}</p>
          <button onClick={()=>resolve(row,'cloud')}>Use cloud version</button><button onClick={()=>resolve(row,'draft')}>Keep my draft against this revision</button></div>}
        {draft.error && <p role="alert">{draft.error} Your draft is retained.</p>}
        <button className="concept-edit-save" disabled={!!draft.current || !draft.form.body.trim() || !draft.form.rationale.trim() || !draft.form.scope.trim() || !draft.form.attribution.trim()} onClick={()=>save(row)}>Save private correction</button>
        <button onClick={()=>exportLexiconDraft({...draft,projectId:record.project_id,conceptId:record.id,definitionId:row.id,annotationId:row.annotation_id,sourceQuotation:row.source_quotation})}>Export correction draft</button>
        <button onClick={()=>{drafts.current.delete(key);changed();}}>Discard correction draft</button>
      </fieldset></div> : <button className="concept-edit-open" onClick={()=>edit(row,{})}>Correct this definition</button>}
      <button className="concept-history-open" onClick={()=>showHistory(row)}>Revision history</button>
      {versions && <div className="concept-history"><h5>Private definition history</h5>{versions.items.map(item=><div key={item.revision}><strong>Revision {item.revision} · {item.snapshot.state}</strong><p dir="auto">{item.snapshot.body}</p><small>{item.snapshot.attribution} · {item.snapshot.scope}</small></div>)}
        {versions.next_before_revision && <button onClick={()=>showHistory(row,true)}>Earlier revisions</button>}</div>}
    </article>;
  }
  return <section className="concept-panel" aria-label="Located definitions and term occurrences">
    <div className="concept-panel-heading"><h3>Definitions & readings</h3><button disabled={loading} onClick={load}>Refresh concept</button></div>
    {loading && <p role="status">Opening recorded definitions and source passages…</p>}
    {error && <p role="alert">{error}</p>}
    {data && <>
      {data.concept.definition_gap && <p className="concept-definition-gap">No active sourced definition or owner paraphrase is recorded yet. A concept label or machine proposal does not fill this gap.</p>}
      {!data.concept.definition_gap && !data.definitions.items.some(row=>row.definition_kind!=='machine_proposed') && data.definitions.next_cursor && <p>A recorded definition is on a later page. Load more definitions below.</p>}
      {data.definitions.items.filter(row=>row.definition_kind!=='machine_proposed').map(definition)}
      {data.definitions.items.some(row=>row.definition_kind==='machine_proposed') && <details className="concept-machine-proposals"><summary>Machine proposals · unreviewed</summary>{data.definitions.items.filter(row=>row.definition_kind==='machine_proposed').map(definition)}</details>}
      {data.definitions.next_cursor && <button onClick={()=>more('definitions')}>More recorded definitions</button>}
      <section className="concept-occurrences"><h4>Where I encountered this concept</h4>{!data.occurrences.items.length && <p>No active private term occurrences recorded.</p>}
        {data.occurrences.items.map(row=>{const text=Array.from(row.source_quotation);return <article key={row.id}>
          <button className="concept-occurrence-source" onClick={()=>navigate(row.source_record_id,record.project_id,row.annotation_id)}>{row.source_title} →</button>
          <small>{row.edition} · {row.locator} · {row.language_tag}{row.script_tag && ` · ${row.script_tag}`}</small>
          <blockquote dir="auto">{text.slice(0,row.term_start).join('')}<mark>{text.slice(row.term_start,row.term_end).join('')}</mark>{text.slice(row.term_end).join('')}</blockquote>
          <small>{row.rationale} · {row.review_state}</small>
        </article>;})}
        {data.occurrences.next_cursor && <button onClick={()=>more('occurrences')}>More reading occurrences</button>}
      </section>
      <details className="concept-senses"><summary>Scoped lexical connections</summary>{data.senses.items.map(row=><article key={row.id}><strong dir="auto">{row.written_rep}</strong><p>{row.scope}</p><small>{row.language_tag} · {row.review_state}</small><p>{row.rationale}</p></article>)}{data.senses.next_cursor && <button onClick={()=>more('senses')}>More connections</button>}</details>
      <p className="concept-coverage">{data.concept.coverage}. Occurrences describe your recorded readings; they do not establish historical transmission or consensus.</p>
    </>}
  </section>;
}
