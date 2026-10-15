import React,{useEffect,useRef,useState} from 'react';
import {selectedPassage} from './passageSelection.js';
import {appendLexicalPage,definitionKinds,exportLexiconDraft,lexicalKey,saveCreation,verifyCapture,verifyDefinition} from './lexiconClient.js';
import './lexicon.css';

export default function LexiconCapture({annotation,sourceId,api,drafts,changed,navigate}) {
  const [open,setOpen]=useState(false),[links,setLinks]=useState([]),[cursor,setCursor]=useState(null),[message,setMessage]=useState('');
  const [results,setResults]=useState([]),[query,setQuery]=useState(()=>Array.from(annotation.exact).length<=80 ? annotation.exact : ''),[senses,setSenses]=useState([]),[representations,setRepresentations]=useState([]);
  const [searching,setSearching]=useState(false);
  const [sensesCursor,setSensesCursor]=useState(null),[representationsCursor,setRepresentationsCursor]=useState(null);
  const alive=useRef(true),generation=useRef(0),quoteRoot=useRef(null);
  const key=lexicalKey(annotation.project_id,annotation.id,'capture');
  const initial=useRef({request_uuid:crypto.randomUUID(),mode:'term',start:0,end:Array.from(annotation.exact).length,
    title:annotation.exact,concept_scope:'',sense_scope:'',language_tag:'und',script_tag:'',transliteration_scheme:'',
    concept_id:'',sense_id:'',representation_id:'',rationale:'',definition_kind:'owner_paraphrase',wording_mode:'paraphrase',
    definition_body:'',attribution:'',dating_note:'',proposal_tool:'',proposal_version:'',proposal_activity:''});
  const form=drafts.current.get(key) || initial.current;
  const locked=!!form.sent || !!form.saving;
  const exact=Array.from(annotation.exact).slice(form.start,form.end).join('');
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;generation.current++;};},[]);
  function edit(patch) {
    if(locked) return;
    drafts.current.set(key,{...form,...patch,error:'',sourceRecordId:sourceId,documentId:annotation.document_id,
      projectId:annotation.project_id,annotationId:annotation.id,selectedQuote:annotation.exact,textSha256:annotation.text_sha256});changed();
  }
  async function loadLinks(append=false) {
    try {
      const value=await api.request('lexicon/annotation-links',{project_id:annotation.project_id,annotation_id:annotation.id,...(append && cursor ? {cursor} : {})});
      if(alive.current) {setLinks(old=>append ? appendLexicalPage(old,value.items) : value.items);setCursor(value.next_cursor);}
    } catch(error) {if(alive.current)setMessage(error.message);}
  }
  async function search(event) {
    event.preventDefault();const token=++generation.current;setSearching(true);setMessage('');
    try {
      const value=await api.request('lexicon/search',{project_id:annotation.project_id,q:query});
      if(value.items.some(row=>row.project_id!==annotation.project_id))throw new Error('Concept results did not match this project.');
      if(alive.current && token===generation.current) {setResults(value.items);if(!value.items.length)setMessage('No matching concepts. You can create a scoped concept for this reading.');else if(value.truncated)setMessage('Showing the first 30 matches. Narrow your search.');}
    } catch(error) {if(alive.current && token===generation.current)setMessage(error.message);}
    finally {if(alive.current && token===generation.current)setSearching(false);}
  }
  async function chooseConcept(row) {
    if(locked || row.project_id!==annotation.project_id) return;
    const token=++generation.current;edit({concept_id:row.id,concept_title:row.title,sense_id:'',representation_id:''});setSenses([]);setRepresentations([]);setSensesCursor(null);setRepresentationsCursor(null);
    try {
      const value=await api.request('lexicon/senses',{project_id:annotation.project_id,concept_id:row.id});
      if(value.items.some(item=>item.project_id!==annotation.project_id || item.concept_id!==row.id))throw new Error('Recorded connections did not match this concept.');
      if(alive.current && token===generation.current) {setSenses(value.items);setSensesCursor(value.next_cursor);setMessage('');}
    } catch(error) {if(alive.current && token===generation.current)setMessage(error.message);}
  }
  async function chooseSense(row) {
    if(locked || row.project_id!==annotation.project_id || row.concept_id!==form.concept_id) return;
    const token=++generation.current;edit({sense_id:row.id,sense_label:row.scope,entry_id:row.entry_id,representation_id:''});setRepresentations([]);setRepresentationsCursor(null);
    try {
      const value=await api.request('lexicon/representations',{project_id:annotation.project_id,entry_id:row.entry_id});
      if(value.items.some(item=>item.project_id!==annotation.project_id || item.entry_id!==row.entry_id))throw new Error('Written representations did not match this entry.');
      if(alive.current && token===generation.current) {setRepresentations(value.items.filter(item=>item.written_rep===exact));setRepresentationsCursor(value.next_cursor);setMessage('Choose the exact recorded spelling to reuse this entry. Other spellings require an explicit variant mapping.');}
    } catch(error) {if(alive.current && token===generation.current)setMessage(error.message);}
  }
  async function moreChoices(kind) {
    const token=generation.current,after=kind==='senses' ? sensesCursor : representationsCursor;
    if(!after)return;
    try {
      const value=await api.request('lexicon/'+kind,{project_id:annotation.project_id,cursor:after,
        ...(kind==='senses' ? {concept_id:form.concept_id} : {entry_id:form.entry_id})});
      if(value.items.some(row=>row.project_id!==annotation.project_id || (kind==='senses' ? row.concept_id!==form.concept_id : row.entry_id!==form.entry_id)))throw new Error('Lexical page did not match this choice.');
      if(alive.current && token===generation.current) {
        if(kind==='senses'){setSenses(old=>appendLexicalPage(old,value.items));setSensesCursor(value.next_cursor);}
        else {setRepresentations(old=>appendLexicalPage(old,value.items.filter(row=>row.written_rep===exact)));setRepresentationsCursor(value.next_cursor);}
      }
    } catch(error){if(alive.current && token===generation.current)setMessage(error.message);}
  }
  function selectWord() {
    try {
      const selected=selectedPassage(quoteRoot.current,getSelection());
      if(!selected) {setMessage('Select the word or phrase inside the quotation.');return;}
      edit({...selected,...(form.title===annotation.exact ? {title:selected.exact} : {}),representation_id:'',sense_id:''});setRepresentations([]);setQuery(selected.exact);setResults([]);setMessage('Selected wording retained exactly.');
    } catch(error) {setMessage(error.message);}
  }
  async function save(event) {
    event.preventDefault();if(form.saving) return;
    let payload,path,validate;
    if(form.sent) {payload=form.sent;path=form.mode==='definition' ? 'lexicon/definitions' : 'lexicon/captures';}
    else if(form.mode==='definition') {
      if(!form.concept_id || !form.definition_body.trim() || !form.attribution.trim() || !form.sense_scope.trim() || !form.rationale.trim()) {setMessage('Choose a concept and provide the definition, attribution, scope, and rationale.');return;}
      if(form.wording_mode==='quotation' && form.definition_body!==annotation.exact) {setMessage('A quotation must match the whole captured passage exactly. Choose paraphrase for your own wording.');return;}
      if(form.definition_kind==='machine_proposed' && [form.proposal_tool,form.proposal_version,form.proposal_activity].some(value=>!value.trim())) {setMessage('Provide the proposal tool, version, and activity ID. The proposal stays unreviewed.');return;}
      payload={definition_uuid:form.request_uuid,project_id:annotation.project_id,annotation_id:annotation.id,concept_id:form.concept_id,
        definition_kind:form.definition_kind,wording_mode:form.wording_mode,body:form.definition_body,attribution:form.attribution,
        scope:form.sense_scope,dating_note:form.dating_note,rationale:form.rationale,owner_confirmed:true,
        proposal_tool:form.proposal_tool,proposal_version:form.proposal_version,proposal_activity:form.proposal_activity};
      path='lexicon/definitions';
    } else {
      if(!form.rationale.trim() || !exact.trim() || (!form.sense_id && !form.sense_scope.trim()) || (!form.concept_id && (!form.title.trim() || !form.concept_scope.trim()))) {setMessage('Provide a concept, scope for this reading, and why you are connecting it.');return;}
      if(form.sense_id && !form.representation_id) {setMessage('Choose an exact written representation for the existing connection.');return;}
      payload={request_uuid:form.request_uuid,project_id:annotation.project_id,annotation_id:annotation.id,start:form.start,end:form.end,
        sense_id:form.sense_id || null,representation_id:form.representation_id || null,sense_scope:form.sense_id ? '' : form.sense_scope,
        entry:form.sense_id ? null : {entry_type:'undetermined',scope:form.sense_scope,language_tag:form.language_tag,script_tag:form.script_tag,transliteration_scheme:form.transliteration_scheme},
        concept:form.sense_id ? null : form.concept_id ? {mode:'existing',concept_id:form.concept_id} : {mode:'new',title:form.title,scope:form.concept_scope,language_tag:'und'},
        rationale:form.rationale,owner_confirmed:true};path='lexicon/captures';
    }
    validate=form.mode==='definition' ? verifyDefinition : (value,sent)=>verifyCapture(api,value,sent,annotation);
    const result=await saveCreation({api,drafts,key,form:{...form,sourceRecordId:sourceId,documentId:annotation.document_id,
      projectId:annotation.project_id,annotationId:annotation.id,selectedQuote:annotation.exact,textSha256:annotation.text_sha256},payload,path,validate,changed});
    if(result && alive.current) {
      initial.current={...initial.current,request_uuid:crypto.randomUUID()};setMessage('Saved privately. Scholarly review is still pending.');setOpen(false);loadLinks();
    }
  }
  return <section className="lexicon-capture" aria-label="Concept connections for this passage">
    <button className="lexicon-toggle" aria-expanded={open} onClick={()=>{setOpen(!open);if(!open)loadLinks();}}>Concepts & definitions{drafts.current.has(key) && ' · unsaved draft'}</button>
    {open && <>
      <div className="lexicon-links"><h5>Saved connections</h5>{!links.length && <p>No active connections loaded for this passage.</p>}
        {links.map(row=><div key={row.id}><button onClick={()=>navigate(row.concept_id,annotation.project_id)}>{row.concept_title}</button><small>{row.link_kind==='term_occurrence' ? 'Located term occurrence' : definitionKinds[row.definition_kind]} · {row.review_state}</small></div>)}
        {cursor && <button onClick={()=>loadLinks(true)}>More saved connections</button>}</div>
      <fieldset disabled={locked} className="lexicon-intent"><legend>What would you like to record?</legend>
        <label>Action<select className="lexicon-mode" value={form.mode} onChange={event=>edit({mode:event.target.value})}><option value="term">Connect a word or phrase</option><option value="definition">Record a definition from this passage</option></select></label>
      </fieldset>
      <blockquote ref={quoteRoot} className="lexicon-source-quote" dir="auto">{annotation.exact}</blockquote>
      {form.mode==='term' && <><button disabled={locked} className="lexicon-select-word" onClick={selectWord}>Use selected wording</button><p>Wording: <strong dir="auto">{exact}</strong></p></>}
      <form className="lexicon-find" onSubmit={search}><label>Find an existing concept<input value={query} onChange={event=>setQuery(event.target.value)} maxLength={500} /></label><button disabled={locked || searching || !query.trim()}>Search concepts</button></form>
      <div className="lexicon-search-results">{results.map(row=><button key={row.id} disabled={locked} onClick={()=>chooseConcept(row)}>{row.title}<small>{row.summary}{row.assertion_kind && ` · ${definitionKinds[row.assertion_kind]}`}</small></button>)}</div>
      <form className="lexicon-author" onSubmit={save}>
        <fieldset disabled={locked}>
          {form.concept_id ? <div className="lexicon-choice"><strong>Concept: {form.concept_title}</strong><button type="button" onClick={()=>{edit({concept_id:'',sense_id:'',representation_id:''});setSenses([]);setRepresentations([]);}}>Change concept</button></div>
            : form.mode==='term' ? <><label>New concept label<input className="lexicon-concept-title" value={form.title} maxLength={2000} onChange={event=>edit({title:event.target.value})} /></label>
              <label>Scope of this concept<textarea className="lexicon-concept-scope" value={form.concept_scope} rows={2} maxLength={10000} onChange={event=>edit({concept_scope:event.target.value})} /></label><small>A scope note describes what you are tracking. It is separate from a sourced definition.</small></>
              : <p>Choose an existing concept above. To create one, first connect a word or phrase.</p>}
          {form.mode==='term' && form.concept_id && senses.length>0 && <details><summary>Reuse a recorded entry and meaning</summary>{senses.map(row=><button type="button" key={row.id} onClick={()=>chooseSense(row)}>{row.written_rep} · {row.scope}</button>)}
            {sensesCursor && <button type="button" onClick={()=>moreChoices('senses')}>More recorded connections</button>}
            {form.sense_id && <label>Exact recorded spelling<select value={form.representation_id} onChange={event=>edit({representation_id:event.target.value})}><option value="">Choose a spelling</option>{representations.map(row=><option value={row.id} key={row.id}>{row.written_rep} · {row.language_tag}</option>)}</select></label>}
            {form.sense_id && representationsCursor && <button type="button" onClick={()=>moreChoices('representations')}>More recorded spellings</button>}
            {form.sense_id && <button type="button" onClick={()=>edit({sense_id:'',representation_id:''})}>Create a separate scoped entry instead</button>}
          </details>}
          {form.mode==='term' && form.sense_id && <div className="lexicon-choice"><p>Recorded connection: {form.sense_label} · {exact}</p>{form.representation_id && <small>Exact recorded spelling selected.</small>}
            <button type="button" onClick={()=>edit({sense_id:'',representation_id:''})}>Use a new scoped entry</button></div>}
          {form.mode==='term' && !form.sense_id && <div className="lexicon-language"><label>Declared language<input value={form.language_tag} maxLength={100} onChange={event=>edit({language_tag:event.target.value})} placeholder="und, en, ar, ar-Latn" /></label><label>Script, if known<input value={form.script_tag} maxLength={4} onChange={event=>edit({script_tag:event.target.value})} placeholder="Arab, Latn" /></label><label>Transliteration scheme, if known<input value={form.transliteration_scheme} maxLength={500} onChange={event=>edit({transliteration_scheme:event.target.value})} /></label></div>}
          {form.mode==='definition' && <>
            <label>What kind of definition?<select className="lexicon-definition-kind" value={form.definition_kind} onChange={event=>edit({definition_kind:event.target.value,proposal_tool:'',proposal_version:'',proposal_activity:''})}>{Object.entries(definitionKinds).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
            <label>Wording<select className="lexicon-wording-mode" value={form.wording_mode} onChange={event=>edit({wording_mode:event.target.value})}><option value="paraphrase">Paraphrase</option><option value="quotation">Exact quotation of this captured passage</option></select></label>
            {form.wording_mode==='quotation' && <button type="button" onClick={()=>edit({definition_body:annotation.exact})}>Use the exact captured wording</button>}
            <label>Definition text<textarea className="lexicon-definition-body" rows={4} maxLength={5000} value={form.definition_body} onChange={event=>edit({definition_body:event.target.value})} /></label>
            <label>Who says this?<input className="lexicon-attribution" value={form.attribution} maxLength={2000} onChange={event=>edit({attribution:event.target.value})} /></label>
            <label>Dating or period uncertainty<input value={form.dating_note} maxLength={2000} onChange={event=>edit({dating_note:event.target.value})} /></label>
            {form.definition_kind==='machine_proposed' && <div className="lexicon-proposal">{[['proposal_tool','Tool'],['proposal_version','Version'],['proposal_activity','Activity ID']].map(([name,label])=><label key={name}>{label}<input value={form[name]} maxLength={500} onChange={event=>edit({[name]:event.target.value})} /></label>)}<small>This records a proposal and leaves the definition gap open.</small></div>}
          </>}
          {(!form.sense_id || form.mode==='definition') && <label>Meaning or scope in this reading<textarea className="lexicon-scope" rows={2} maxLength={10000} value={form.sense_scope} onChange={event=>edit({sense_scope:event.target.value})} /></label>}
          <label>Why this connection or definition?<textarea className="lexicon-rationale" rows={2} maxLength={2000} value={form.rationale} onChange={event=>edit({rationale:event.target.value})} /></label>
        </fieldset>
        {form.sent && !form.saving && <p role="alert">The outcome is uncertain. Retrying sends the same request and cannot create a duplicate.</p>}
        {form.error && <p role="alert">{form.error}</p>}
        <button className="lexicon-save" disabled={!!form.saving}>{form.saving ? 'Saving…' : form.sent ? 'Retry exact save' : form.mode==='definition' ? 'Save private definition' : 'Save concept connection'}</button>
        {drafts.current.has(key) && <button type="button" onClick={()=>exportLexiconDraft(form)}>Export retained draft</button>}
        {!locked && drafts.current.has(key) && <button type="button" onClick={()=>{drafts.current.delete(key);changed();setMessage('Draft discarded.');}}>Discard draft</button>}
      </form>
      <small>Source version and quotation stay attached. Saving is private and does not complete scholarly review.</small>
    </>}
    {message && <p className="lexicon-message" role="status">{message}</p>}
  </section>;
}
