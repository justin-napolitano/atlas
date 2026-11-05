/** Private owner-declared passage connections; never inferred explicit citations. */
export const verseLinkKey=(project,annotation)=>`verse-link:${JSON.stringify([project,annotation])}`;
export const verseMaterialKinds={scholarship:'Scholarship',tafsir:'Commentary / tafsīr',linguistic_annotation:'Linguistic annotation'};
export function verseLinkPayload(form,projectId,annotation) {
  const chapter=Number(form.chapter),start=Number(form.ayah_start),end=Number(form.ayah_end || form.ayah_start);
  if(!Number.isInteger(chapter) || chapter<1 || chapter>114 || !Number.isInteger(start) || start<1 ||
    !Number.isInteger(end) || end<start || end>286)throw new Error('Choose a surah and ordered ayah range. Exact surah bounds are checked when saving.');
  if(annotation.project_id!==projectId || !Object.hasOwn(verseMaterialKinds,form.material_kind) || !['discussion','interpretive_claim'].includes(form.link_kind))throw new Error('Choose this passage’s project and a supported connection type.');
  if(!form.confirmed || !form.attribution.trim() || !form.source_scope.trim() || !form.rationale.trim())throw new Error('Add attribution, scope, and a reason, then confirm your connection.');
  const interpretation=form.link_kind==='interpretive_claim';
  if(interpretation && (!['quotation','paraphrase'].includes(form.assertion_mode) || !form.assertion_text.trim() ||
    (form.assertion_mode==='quotation' && form.assertion_text!==annotation.exact)))throw new Error('Quote the whole selected passage exactly, or label your wording as a paraphrase.');
  return {request_uuid:form.request_uuid,project_id:projectId,annotation_id:annotation.id,chapter,ayah_start:start,ayah_end:end,
    material_kind:form.material_kind,link_kind:form.link_kind,citation_basis:'none',citation_id:null,marker_start:null,marker_end:null,
    attribution:form.attribution,language_tag:'und',source_scope:form.source_scope,rationale:form.rationale,
    assertion_mode:interpretation ? form.assertion_mode : 'none',assertion_text:interpretation ? form.assertion_text : '',
    reading_note:'',period_note:'',tradition_note:'',context_basis:'',state:'active',owner_confirmed:true};
}
export function verifyVerseLinkRow(row,projectId,annotation) {
  if(!row || typeof row.id!=='string' || row.project_id!==projectId || row.annotation_id!==annotation.id ||
    row.document_id!==annotation.document_id || row.text_sha256!==annotation.text_sha256 || row.selected_quote!==annotation.exact ||
    !row.reference || row.reference.chapter!==row.chapter || row.reference.ayah_start!==row.ayah_start || row.reference.ayah_end!==row.ayah_end ||
    typeof row.reference.id!=='string' || typeof row.reference.label!=='string')throw new Error('Verse connection did not match this exact source passage.');
  return row;
}
export async function verifyVerseLink(api,result,sent,annotation) {
  if(!result || typeof result.id!=='string' || result.project_id!==sent.project_id || !Number.isInteger(result.revision) || result.revision<1)throw new Error('The saved connection identity could not be confirmed.');
  const row=verifyVerseLinkRow(await api.request('verses/material',{project_id:sent.project_id,material_id:result.id}),sent.project_id,annotation);
  if(row.id!==result.id || row.revision!==result.revision || ['chapter','ayah_start','ayah_end','material_kind','link_kind','citation_basis','attribution','source_scope','rationale','assertion_mode','assertion_text','state'].some(key=>row[key]!==sent[key]))throw new Error('The saved connection differs from the submitted target or interpretation.');
  return row;
}
/** Retain exact uncertain writes, including their UUID, until source-bound readback. */
export async function saveVerseLink({api,form,payload,annotation,update}) {
  const sent=JSON.parse(JSON.stringify(form.sent || payload));update({...form,sent,saving:true,error:''});
  try {const value=await api.post('verses/materials',sent);return await verifyVerseLink(api,value,sent,annotation);}
  catch(error){const rejected=!form.sent && [400,413,422].includes(error.status);update({...form,saving:false,sent:rejected ? null : sent,error:rejected ? 'The request was rejected. Check the target range and required fields; your draft is retained.' : 'The save could not be confirmed. Your exact request is retained; retry it before changing this connection.'});return null;}
}
