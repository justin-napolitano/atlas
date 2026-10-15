import React,{useEffect,useRef,useState} from 'react';
import {savePilotWrite} from './pilotClient.js';
import {verifyCollectionReadingLink} from './collectionLinkClient.js';

/** Owner confirmation binds an already-saved exact reading to its typed verse role. */
export default function CollectionReadingLink({api,projectId,readingId,documentId,sourceRecordId,drafts,changed,onOpen,onVerse}){
  const [collection,setCollection]=useState(null),[message,setMessage]=useState('');const alive=useRef(true),busy=useRef(false);
  const key='collection-link:'+JSON.stringify([projectId,readingId,documentId]);
  const form=drafts.current.get(key) || {request_uuid:crypto.randomUUID(),rationale:'',confirmed:false};
  const reading=collection?.readings.find(row=>row.id===readingId),source=collection?.sources.find(row=>row.id===reading?.source_id);
  function update(value){drafts.current.set(key,value);changed();}
  useEffect(()=>{alive.current=true;api.request('reading/collection').then(value=>{if(alive.current)setCollection(value);}).catch(error=>{if(alive.current)setMessage(error.message);});return()=>{alive.current=false;};},[projectId,readingId,documentId]);
  async function save(event){event.preventDefault();if(busy.current || !reading || (!form.sent && !form.confirmed))return;busy.current=true;
    const result=await savePilotWrite({api,path:'reading/link-collection',form,payload:{project_id:projectId,reading_id:readingId,document_id:documentId,request_uuid:form.request_uuid,rationale:form.rationale,owner_confirmed:true},update,
      verify:(receipt,sent)=>verifyCollectionReadingLink(api,receipt,sent,reading,source)});
    busy.current=false;if(result){drafts.current.delete(key);changed();if(alive.current)onOpen(result.record_id,projectId,result.annotation_id,result.document_id);}
  }
  return <section className="collection-reading-link"><h2>Your reading is saved. Connect it to the verse?</h2>
    {message && <p role="alert">{message}</p>}
    {!reading || !source ? <p role="status">{collection ? 'That reading is unavailable. Reopen the saved source from your library.' : 'Loading the identified reading…'}</p> : <>
      <p>{source.title} · {reading.reference.label || `Q 4:${reading.reference.ayah_start}`}</p><blockquote dir="auto">{reading.text}</blockquote><p>{reading.locator}</p><p>{reading.source_scope}</p>
      <p>This adds an exact source anchor and a pending {reading.material_kind==='translation' ? 'named translation representation' : 'commentary/discussion'} link. It does not approve an interpretation or publish your research.</p>
      <form onSubmit={save}><label>Why connect this reading?<textarea required maxLength={2000} value={form.rationale} disabled={!!form.sent || form.saving} onChange={event=>update({...form,rationale:event.target.value,confirmed:false})}/></label>
        <label><input type="checkbox" checked={form.confirmed} disabled={!!form.sent || form.saving} onChange={event=>update({...form,confirmed:event.target.checked})}/>Create this private, source-bound link to Q {reading.reference.chapter}:{reading.reference.ayah_start}.</label>
        <button disabled={form.saving || (!form.sent && !form.confirmed)}>{form.saving ? 'Saving connection…' : form.sent ? 'Retry original reading connection' : 'Connect reading & open source'}</button>
      </form>{form.error && <p role="alert">{form.error}</p>}
      <button onClick={()=>onVerse(reading.reference)}>View recorded verse material</button>
      <button onClick={()=>onOpen(sourceRecordId,projectId,'',documentId)}>Read the saved source without linking</button>
    </>}
  </section>;
}
