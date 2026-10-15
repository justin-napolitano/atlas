import React,{useEffect,useMemo,useRef,useState} from 'react';
import {applySourcePreset,saveSourceIntake,sourceIntakePayload} from './sourceIntakeClient.js';
import './sourceIntake.css';

const labels={primary_text:'Primary text',translation:'Translation',commentary:'Commentary',scholarship:'Scholarship',reference:'Reference work',undetermined:'Role not yet determined',
  unknown:'Unknown',open:'Open access',subscription:'Subscription',owned_copy:'My copy',unavailable:'Unavailable',metadata_only:'Metadata only',
  permitted_excerpt:'Permitted excerpt',public_domain:'Public domain',open_license:'Open license',abstract:'Abstract',selected_passage:'Selected passage',full_work_read:'Full work read by me'};

/** Owner-only source intake. Pass the workspace's page-memory drafts ref and API.
 * @param {{api:object,projectId:string,drafts?:object,changed?:function,onCreated:function,onCancel?:function,initialPreset?:object}} props
 * @remarks onCreated receives {project_id,record_id,document_id}; no automatic publication or scholarly review occurs.
 */
export default function AddSource({api,projectId,drafts,changed=()=>{},onCreated,onCancel,initialPreset}) {
  const localDrafts=useRef(new Map()),store=drafts || localDrafts;
  const key=`source-intake:${JSON.stringify(projectId)}`;
  const initial=useMemo(()=>applySourcePreset({intake_uuid:crypto.randomUUID(),title:'',creators:'',publication:'',publication_date:'',language:'',accessed_on:'',intake_context:'',edition:'',identifier:'',source_url:'',
    source_role:'undetermined',access_status:'unknown',rights_status:'metadata_only',rights_basis:'',coverage_scope:'metadata_only',rationale:'',
    distinct_source_rationale:'',existing_source_record_id:'',existing_title:'',include_excerpt:false,text:'',locator:'',step:1,identity_checked:false,confirmed:false},initialPreset),[projectId,initialPreset]);
  const [,render]=useState(0),[matches,setMatches]=useState([]),[searchResults,setSearchResults]=useState([]),[search,setSearch]=useState(''),[message,setMessage]=useState(''),[checking,setChecking]=useState(false);
  const alive=useRef(true),generation=useRef(0),saving=useRef(false);
  const form=store.current.get(key) || initial,locked=!!form.sent || !!form.saving;
  function update(value){store.current.set(key,value);render(n=>n+1);changed();}
  function edit(patch){if(!locked){generation.current++;update({...form,...patch,confirmed:false,error:'',...(Object.hasOwn(patch,'source_url') || Object.hasOwn(patch,'identifier') ? {identity_checked:false,existing_source_record_id:'',existing_title:''} : {})});}}
  useEffect(()=>{alive.current=true;setMatches([]);setSearchResults([]);setMessage('');return()=>{alive.current=false;generation.current++;};},[projectId]);
  useEffect(()=>{const warn=event=>{if(store.current.has(key)){event.preventDefault();event.returnValue='';}};addEventListener('beforeunload',warn);return()=>removeEventListener('beforeunload',warn);},[key,store]);
  async function checkIdentity(event) {
    event.preventDefault();if(locked)return;
    setChecking(true);setMessage('');const token=++generation.current;
    try {
      const value=await api.request('source-intakes/candidates',{project_id:projectId,source_url:form.source_url,identifier:form.identifier});
      if(form.preferred_record_id && !value.items.some(row=>row.id===form.preferred_record_id)){
        const preferred=await api.request('record',{record_id:form.preferred_record_id}).catch(error=>{if(error.status===404)return null;throw error;});
        if(preferred && preferred.project_id===projectId && !preferred.deleted_at && ['source','work','edition'].includes(preferred.kind))value.items.unshift(preferred);
      }
      if(value.items.some(row=>row.project_id!==projectId || !['source','work','edition'].includes(row.kind)))throw new Error('Source matches did not belong to this project.');
      if(alive.current && generation.current===token){setMatches(value.items);update({...form,identity_checked:true,step:2,confirmed:false});setMessage(value.truncated ? 'More than 20 sources share these hints. Search existing source titles before proceeding.' : 'Identity hints checked. Matching hints do not establish that editions are the same.');}
    }catch(error){if(alive.current)setMessage(error.message);}finally{if(alive.current)setChecking(false);}
  }
  async function searchExisting(event) {
    event.preventDefault();if(!search.trim())return;const token=++generation.current;setMessage('');
    try {
      const value=await api.request('search',{project_id:projectId,q:search,scope:'records',limit:30});
      if(value.items.some(row=>row.project_id!==projectId))throw new Error('Search results did not belong to this project.');
      if(alive.current && token===generation.current){setSearchResults(value.items.filter(row=>['source','work','edition'].includes(row.kind)));setMessage('Showing source, work, and edition matches from the first 30 search results. Narrow the title if needed.');}
    }catch(error){if(alive.current)setMessage(error.message);}
  }
  function choose(row){edit({existing_source_record_id:row.id,existing_title:row.title});}
  async function save(event) {
    event.preventDefault();if(saving.current || form.saving || (!form.sent && !form.confirmed))return;
    saving.current=true;
    try{const result=await saveSourceIntake({api,form,payload:sourceIntakePayload(form,projectId),update});
      if(result){store.current.delete(key);changed();if(alive.current)onCreated(result);}}
    finally{saving.current=false;}
  }
  function exportDraft(){const url=URL.createObjectURL(new Blob([JSON.stringify({format:'private-source-intake-draft-1',project_id:projectId,draft:form},null,2)],{type:'application/json'}));
    const link=document.createElement('a');link.href=url;link.download='private-source-intake-draft.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  const input=(name,label,max,required=false)=> <label>{label}<input name={name} value={form[name]} maxLength={max} required={required} disabled={locked} onChange={event=>edit({[name]:event.target.value})}/></label>;
  const select=(name,label,options)=><label>{label}<select value={form[name]} disabled={locked} onChange={event=>edit({[name]:event.target.value})}>{options.map(value=><option key={value} value={value}>{labels[value]}</option>)}</select></label>;
  return <section className="source-intake" aria-labelledby="source-intake-heading">
    <header><div><p className="eyebrow">Your research library</p><h2 id="source-intake-heading">Add a source</h2></div>{onCancel && <button type="button" disabled={form.saving} onClick={onCancel}>Back to reading</button>}</header>
    <p>Record the source, identify its edition, then optionally bring a located excerpt into the reader. Metadata stays private and pending review.</p>
    {initialPreset && store.current.has(key) && form.preset_id!==initialPreset.preset_id && <p className="intake-retained-warning" role="status">You have an unfinished source intake for “{form.title || 'Untitled source'}”. It is shown below. The newly selected reading “{initialPreset.title}” has not replaced it. Finish this intake or export and discard it before starting the selected reading.</p>}
    {form.preset_note && <p className="intake-preset-note">{form.preset_note}</p>}
    <ol className="intake-steps" aria-label="Source intake steps">{['Source','Identity & access','Review & read'].map((label,i)=><li key={label} aria-current={form.step===i+1 ? 'step' : undefined}>{i+1}. {label}</li>)}</ol>
    {form.step===1 && <form onSubmit={checkIdentity}>
      <p>Enter details yourself. URLs and identifiers are recorded, not fetched or automatically resolved. You can save metadata when text is unavailable.</p>
      {input('title','Title',2000,true)}{input('source_url','Source URL (optional)',2000)}{input('identifier','DOI, ISBN, or another identifier (optional)',2000)}
      <div className="intake-grid">{input('creators','Author / editor / translator',2000)}{input('publication','Publication / publisher',2000)}{input('publication_date','Publication date or uncertainty',200)}{input('edition','Edition / translation / version (say if unknown)',1000,true)}{input('language','Language (optional, as declared)',200)}{input('accessed_on','Date you accessed it (YYYY-MM-DD, optional)',10)}</div>
      {input('intake_context','Metadata / capture provenance (optional)',2000)}
      {select('source_role','Role of this source',['undetermined','primary_text','translation','commentary','scholarship','reference'])}
      <label>Why add this source?<textarea name="rationale" value={form.rationale} maxLength={2000} required disabled={locked} onChange={event=>edit({rationale:event.target.value})}/></label>
      <button disabled={checking || locked}>{checking ? 'Checking identity hints…' : 'Check identity & continue'}</button>
    </form>}
    {form.step===2 && <>
      <section aria-labelledby="intake-existing"><h3 id="intake-existing">Check your library</h3><p>Exact URL/identifier checks cover earlier manual intakes. Search titles too, especially for imported records and other editions.</p>
        {!!matches.length && <><p>These sources share a URL or identifier. Inspect the edition before reusing one.</p><ul>{matches.map(row=><li key={row.id}><strong>{row.title}</strong> · {row.intake_metadata?.edition || 'Edition not recorded'} <button type="button" disabled={locked} onClick={()=>choose(row)}>Reuse this source</button></li>)}</ul></>}
        <form onSubmit={searchExisting}><label>Find an existing source by title<input value={search} disabled={locked} onChange={event=>setSearch(event.target.value)} maxLength={500}/></label><button disabled={locked}>Search library</button></form>
        <ul>{searchResults.map(row=><li key={row.id}>{row.title} · {row.kind} <button type="button" disabled={locked} onClick={()=>choose(row)}>Reuse this source</button></li>)}</ul>
        {form.existing_source_record_id ? <p>Using <strong>{form.existing_title}</strong>. Its bibliography will stay unchanged; this intake records your declarations separately. <button disabled={locked} onClick={()=>edit({existing_source_record_id:'',existing_title:''})}>Create a separate source instead</button></p> : <p>A new pending source record will be added to this project.</p>}
        {!!matches.length && !form.existing_source_record_id && <label>Why is this a distinct source or edition?<textarea value={form.distinct_source_rationale} maxLength={2000} disabled={locked} onChange={event=>edit({distinct_source_rationale:event.target.value})}/></label>}
      </section>
      <form onSubmit={event=>{event.preventDefault();edit({step:3});}}>
        <div className="intake-grid">{select('access_status','Access',['unknown','open','subscription','owned_copy','unavailable'])}{select('coverage_scope','What have you read?',['metadata_only','abstract','selected_passage','full_work_read'])}</div>
        <p>Reading coverage is your declaration. It does not verify an argument or approve public reuse.</p>
        <label className="intake-check"><input type="checkbox" checked={form.include_excerpt} disabled={locked} onChange={event=>edit({include_excerpt:event.target.checked,...(event.target.checked && form.coverage_scope==='metadata_only' ? {coverage_scope:'selected_passage'} : {})})}/>Bring a permitted excerpt into the reader</label>
        {select('rights_status','Text reuse status',['metadata_only','unknown','permitted_excerpt','public_domain','open_license'])}
        {form.include_excerpt && <>
          <label>Permission / license / other basis for this excerpt<textarea value={form.rights_basis} maxLength={2000} required disabled={locked} onChange={event=>edit({rights_basis:event.target.value})}/></label>
          {input('locator','Exact page, section, clause, or verse',2000,true)}
          <label>Plain-text excerpt (up to 12,000 characters)<textarea className="intake-text" dir="auto" value={form.text} maxLength={12000} required disabled={locked} onChange={event=>edit({text:event.target.value})}/></label>
          <p>Preserve the wording. This imports a bounded excerpt, not the full document or a verified transcription.</p>
        </>}
        <div className="intake-actions"><button type="button" disabled={locked} onClick={()=>edit({step:1})}>Back</button><button disabled={locked || (!!matches.length && !form.existing_source_record_id && !form.distinct_source_rationale.trim()) || (form.include_excerpt && (!['permitted_excerpt','public_domain','open_license'].includes(form.rights_status) || form.coverage_scope==='metadata_only'))}>Review source</button></div>
      </form>
    </>}
    {form.step===3 && <form onSubmit={save}>
      <h3>{form.existing_title || form.title}</h3><dl><dt>Edition / version declared for this intake</dt><dd>{form.edition}</dd><dt>Source role</dt><dd>{labels[form.source_role]}</dd><dt>Coverage</dt><dd>{labels[form.coverage_scope]} · owner declared</dd><dt>Access / reuse</dt><dd>{labels[form.access_status]} / {labels[form.rights_status]}</dd><dt>Reading material</dt><dd>{form.include_excerpt ? `Located excerpt: ${form.locator}` : 'Metadata only. You can add a permitted excerpt later.'}</dd><dt>Source identity</dt><dd>{form.existing_source_record_id ? 'Explicitly reusing a library record; bibliography unchanged.' : 'New pending source; bibliographic identity remains unresolved.'}</dd></dl>
      {form.include_excerpt && <details><summary>Inspect excerpt wording and rights basis</summary><p>{form.rights_basis}</p><blockquote dir="auto">{form.text}</blockquote></details>}
      <p>Saving creates private research material. It does not establish scholarly quality, verify authorship or editions, update the curated graph, or publish anything.</p>
      <label className="intake-check"><input type="checkbox" checked={form.confirmed} disabled={locked} onChange={event=>update({...form,confirmed:event.target.checked})}/>I reviewed these declarations and any permission needed to store this excerpt.</label>
      <div className="intake-actions"><button type="button" disabled={locked} onClick={()=>edit({step:2})}>Back</button><button disabled={form.saving || (!form.sent && !form.confirmed)}>{form.saving ? 'Saving…' : form.sent ? 'Retry exact save' : form.include_excerpt ? 'Save & start reading' : 'Save source'}</button></div>
    </form>}
    {(message || form.error) && <p role="status">{form.error || message}</p>}
    {store.current.has(key) && <p className="intake-draft">Unsaved draft stays in this tab until saved. <button type="button" onClick={exportDraft}>Download private draft</button></p>}
  </section>;
}
