import React,{useEffect,useRef,useState} from 'react';
import {saveVerseLink,verseLinkKey,verseLinkPayload,verseMaterialKinds,verifyVerseLinkRow} from './verseLinksClient.js';
import './verseLinks.css';

/** Link a saved passage to a verse as a scoped owner discussion or interpretation.
 * @remarks Loads only on expansion or explicit refresh. Drafts use the workspace's
 * page-memory ref. onOpenVerse receives the backend's stable reference object.
 */
export default function VerseLinks({api,projectId,annotation,sourceTitle='',drafts,changed=()=>{},onOpenVerse}) {
  const fallback=useRef(new Map()),store=drafts || fallback,key=verseLinkKey(projectId,annotation.id);
  const [open,setOpen]=useState(false),[rows,setRows]=useState([]),[cursor,setCursor]=useState(null),[loading,setLoading]=useState(false),[message,setMessage]=useState(''),[,render]=useState(0);
  const initial=useRef(null);if(initial.current?.key!==key)initial.current={key,request_uuid:crypto.randomUUID(),chapter:'4',ayah_start:'',ayah_end:'',material_kind:'scholarship',link_kind:'discussion',attribution:'',source_scope:'',rationale:'',assertion_mode:'paraphrase',assertion_text:'',confirmed:false};
  const form=store.current.get(key) || initial.current,locked=!!form.sent || !!form.saving;
  const active=useRef(true),generation=useRef(0),saving=useRef(false);
  useEffect(()=>{active.current=true;generation.current++;setOpen(false);setRows([]);setCursor(null);setMessage('');setLoading(false);return()=>{active.current=false;generation.current++;};},[key]);
  function update(value){store.current.set(key,{...value,projectId,documentId:annotation.document_id,verseAnnotationId:annotation.id});changed();if(active.current)render(x=>x+1);}
  function edit(patch){update({...form,...patch,confirmed:false,error:''});}
  async function load(next=''){
    const token=++generation.current;setLoading(true);setMessage('');
    try{const value=await api.request('verses/annotation-links',{project_id:projectId,annotation_id:annotation.id,cursor:next,limit:25});
      if(!Array.isArray(value.items))throw new Error('The connection list could not be confirmed.');
      value.items.forEach(row=>verifyVerseLinkRow(row,projectId,annotation));
      if(active.current && token===generation.current){setRows(old=>next ? [...new Map([...old,...value.items].map(row=>[row.id,row])).values()] : value.items);setCursor(value.next_cursor || null);}
    }catch(error){if(active.current && token===generation.current)setMessage(error.message);}finally{if(active.current && token===generation.current)setLoading(false);}
  }
  async function save(event){event.preventDefault();if(saving.current)return;let payload;
    try{payload=form.sent || verseLinkPayload(form,projectId,annotation);}catch(error){update({...form,error:error.message});return;}
    saving.current=true;const token=generation.current;
    const row=await saveVerseLink({api,form,payload,annotation,update});saving.current=false;
    if(row){store.current.delete(key);changed();if(active.current && token===generation.current){initial.current=null;render(x=>x+1);await load();setMessage('Connection saved privately. Scholarly review is unchanged.');}}
  }
  function download(){const blob=URL.createObjectURL(new Blob([JSON.stringify({format:'private-verse-link-draft-1',project_id:projectId,annotation_id:annotation.id,document_id:annotation.document_id,text_sha256:annotation.text_sha256,draft:form},null,2)],{type:'application/json'}));const link=document.createElement('a');link.href=blob;link.download='private-verse-link-draft.json';link.click();setTimeout(()=>URL.revokeObjectURL(blob),1000);}
  const field=(name,label,max=2000)=><label>{label}<textarea name={name} maxLength={max} required value={form[name]} onChange={event=>edit({[name]:event.target.value})}/></label>;
  return <section className="verse-links" aria-label="Verse connections for this passage">
    <button type="button" aria-expanded={open} onClick={()=>{setOpen(!open);if(!open)load();}}>{open ? 'Hide verse connections' : 'Link to verse'}{store.current.has(key) && ' · unsaved draft'}</button>
    {open && <><p>Connect this passage to a verse as your own scoped research link. This does not assert an explicit citation or establish the source’s interpretation as fact.</p>
      {sourceTitle && <p>Source: {sourceTitle}</p>}
      <div className="verse-links-saved">{rows.map(row=><article key={row.id}>
        {onOpenVerse ? <button type="button" onClick={()=>onOpenVerse(row.reference)}>{row.reference.label}</button> : <strong>{row.reference.label}</strong>}
        <p>{row.link_kind==='interpretive_claim' ? 'Attributed interpretation' : row.link_kind==='discussion' ? 'Discussion link' : row.link_kind.replaceAll('_',' ')} · {verseMaterialKinds[row.material_kind] || row.material_kind.replaceAll('_',' ')} · owner-declared, pending review</p>
        <p>{row.attribution}</p><p>{row.source_scope}</p>{row.assertion_text && <blockquote dir="auto">{row.assertion_text}<small>{row.assertion_mode==='quotation' ? 'Exact selected quotation' : 'Attributed paraphrase'}</small></blockquote>}<p>Why linked: {row.rationale}</p>
      </article>)}</div>
      {!loading && !rows.length && <p>No saved verse materials loaded for this passage.</p>}
      <div className="verse-links-actions"><button type="button" disabled={loading} onClick={()=>load()}>Refresh verse connections</button>{cursor && <button type="button" disabled={loading} onClick={()=>load(cursor)}>More verse connections</button>}</div>
      <form onSubmit={save}><fieldset disabled={locked}><legend>Add a verse connection</legend>
        <div className="verse-links-range">{[['chapter','Surah',114],['ayah_start','First ayah',286],['ayah_end','Last ayah (optional)',286]].map(([name,label,max])=><label key={name}>{label}<input name={name} type="number" min="1" max={max} required={name!=='ayah_end'} value={form[name]} onChange={event=>edit({[name]:event.target.value})}/></label>)}</div>
        <label>Source role<select name="material_kind" value={form.material_kind} onChange={event=>edit({material_kind:event.target.value})}>{Object.entries(verseMaterialKinds).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
        <label>Connection type<select name="link_kind" value={form.link_kind} onChange={event=>edit({link_kind:event.target.value})}><option value="discussion">This passage discusses the verse</option><option value="interpretive_claim">This passage offers an interpretation</option></select></label>
        {field('attribution','Who says this?')}{field('source_scope','Scope and limits',10000)}{field('rationale','Why link this passage?')}
        {form.link_kind==='interpretive_claim' && <><label>Interpretation wording<select name="assertion_mode" value={form.assertion_mode} onChange={event=>edit({assertion_mode:event.target.value,assertion_text:event.target.value==='quotation' ? annotation.exact : ''})}><option value="paraphrase">My attributed paraphrase</option><option value="quotation">Exact whole selected quotation</option></select></label>{field('assertion_text','Attributed interpretation',5000)}</>}
        <label className="verse-links-confirm"><input type="checkbox" checked={form.confirmed} onChange={event=>update({...form,confirmed:event.target.checked})}/>I checked the verse, source attribution, scope, and wording. Save privately as pending review.</label>
      </fieldset>{form.error && <p role="alert">{form.error}</p>}
        <div className="verse-links-actions"><button disabled={!!form.saving || (!form.sent && !form.confirmed)}>{form.saving ? 'Saving connection…' : form.sent ? 'Retry exact connection save' : 'Save verse connection'}</button>{store.current.has(key) && <button type="button" onClick={download}>Download private connection draft</button>}</div>
      </form><p>Unsaved drafts stay in this tab’s memory. Saved links are available through your authenticated workspace.</p>
    </>}{loading && <p role="status">Loading verse connections…</p>}{message && <p role="status">{message}</p>}
  </section>;
}
