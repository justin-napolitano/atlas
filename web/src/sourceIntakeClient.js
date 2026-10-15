/** Build an explicit owner-declared intake; no URL fetching or metadata inference. */
export function sourceIntakePayload(form,projectId) {
  const {intake_uuid,title,creators,publication,publication_date,language,accessed_on,edition,identifier,source_url,source_role,
    access_status,rights_status,rights_basis,coverage_scope,rationale,distinct_source_rationale,existing_source_record_id}=form;
  return {intake_uuid,project_id:projectId,title,creators,publication,publication_date,language,accessed_on,edition,identifier,source_url,source_role,
    access_status,rights_status,rights_basis,coverage_scope,rationale,distinct_source_rationale,
    existing_source_record_id:existing_source_record_id || null,owner_confirmed:true,
    excerpt:form.include_excerpt ? {text:form.text,edition,locator:form.locator,representation_url:source_url} : null};
}

/** Confirm source/snapshot identity before navigating away from a saved draft. */
export async function verifySourceIntake(api,result,sent) {
  if(result?.project_id!==sent.project_id || typeof result.record_id!=='string' || !result.record_id ||
    (sent.existing_source_record_id && result.record_id!==sent.existing_source_record_id)) throw new Error('The saved source identity could not be confirmed.');
  const record=await api.request('record',{record_id:result.record_id});
  if(record.id!==result.record_id || record.project_id!==sent.project_id || !['source','work','edition'].includes(record.kind) || record.deleted_at)
    throw new Error('The saved source does not belong to this project.');
  if(sent.excerpt) {
    if(typeof result.document_id!=='string' || !result.document_id)throw new Error('The excerpt save could not be confirmed.');
    const doc=await api.request('reading/document',{project_id:sent.project_id,document_id:result.document_id});
    if(doc.id!==result.document_id || doc.project_id!==sent.project_id || doc.source_record_id!==result.record_id ||
      doc.edition!==sent.excerpt.edition || doc.locator!==sent.excerpt.locator || doc.representation_url!==sent.excerpt.representation_url ||
      doc.text_body!==sent.excerpt.text.replaceAll('\r\n','\n').replaceAll('\r','\n')) throw new Error('The saved excerpt did not match the submitted edition, location, and wording.');
  } else if(result.document_id!==null)throw new Error('Unexpected excerpt in a metadata-only save.');
}

/** Freeze uncertain requests until their exact receipt is acknowledged. */
export async function saveSourceIntake({api,form,payload,update}) {
  const sent=JSON.parse(JSON.stringify(form.sent || payload));
  update({...form,sent,saving:true,error:''});
  try {
    const result=await api.post('source-intakes',sent);
    await verifySourceIntake(api,result,sent);
    return result;
  } catch(error) {
    const rejected=!form.sent && [400,413,422].includes(error.status);
    update({...form,sent:rejected ? null : sent,saving:false,error:rejected
      ? 'The request was rejected. Check the edition, rights basis, text location, and any existing-source choice. Your draft is retained.'
      : 'The save could not be confirmed. Your exact request is retained. Retry it before editing or adding this source again.'});
    return null;
  }
}
