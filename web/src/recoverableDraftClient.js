/** Reuse the actual pending capture identity so committing it is detectable. */
export function retainedCaptureUUID(selection) {
  return typeof selection?.annotation_uuid==='string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(selection.annotation_uuid) ? selection.annotation_uuid : null;
}

/** Stable identity for unfinished writing; source selection is never relocated. */
export function recoveryContext({projectId,recordId,contextKind,document,annotation,selection,baseRevision=0}) {
  const passage=contextKind!=='record_note',selected=contextKind==='annotation' ? annotation : selection;
  return {project_id:projectId,record_id:recordId,context_kind:contextKind,
    document_id:passage ? document?.id : null,annotation_id:contextKind==='annotation' ? annotation?.id : null,
    text_sha256:passage ? document?.text_sha256 : null,start:passage ? (selected?.start_pos ?? selected?.start) : null,
    end:passage ? (selected?.end_pos ?? selected?.end) : null,exact:passage ? selected?.exact : '',
    capture_kind:passage ? (selected?.capture_kind || 'comment') : null,
    base_revision:contextKind==='annotation' ? (baseRevision || annotation?.revision) : contextKind==='capture' ? 0 : baseRevision};
}

/** Restore a server row as a strict full-context CAS request, excluding metadata. */
export function draftRowPayload(row) {
  return {draft_uuid:row.id.slice('urn:research:draft:'.length),project_id:row.project_id,record_id:row.record_id,context_kind:row.context_kind,
    document_id:row.document_id,annotation_id:row.annotation_id,text_sha256:row.text_sha256,start:row.start_pos,end:row.end_pos,exact:row.exact,capture_kind:row.capture_kind,
    base_revision:row.base_revision,body:row.body,mark_style:row.mark_style,state:row.state,expected_revision:row.revision};
}

/** Bind recovered content to the exact active record, edition and saved passage. */
export function verifyRecoveredDraft(row,context) {
  if(!row || !/^urn:research:draft:[0-9a-f-]{36}$/.test(row.id) || row.project_id!==context.project_id || row.record_id!==context.record_id || row.context_kind!==context.context_kind ||
    !Number.isInteger(row.revision) || row.revision<1 || typeof row.body!=='string' || Array.from(row.body).length>10000 || !['active','discarded'].includes(row.state) || !['highlight','underline','none'].includes(row.mark_style))throw new Error('The draft did not match this reading context.');
  if(context.context_kind==='record_note') {
    if(row.document_id!==null || row.annotation_id!==null || row.text_sha256!==null || row.start_pos!==null || row.end_pos!==null || row.exact!=='' || row.mark_style!=='none')throw new Error('The record draft contains an unrelated passage selector.');
  } else if(row.document_id!==context.document_id || row.text_sha256!==context.text_sha256 || row.annotation_id!==context.annotation_id ||
    !Number.isInteger(row.start_pos) || !Number.isInteger(row.end_pos) || row.start_pos<0 || row.end_pos<=row.start_pos || Array.from(row.exact || '').length!==row.end_pos-row.start_pos ||
    (context.context_kind==='annotation' && (row.start_pos!==context.start || row.end_pos!==context.end || row.exact!==context.exact)))throw new Error('The draft belongs to another exact source passage.');
  return row;
}

/** Freeze a draft write until its exact CAS acknowledgement is known. */
export async function saveRecoverableDraft({api,payload,pending,context,update}) {
  const sent=structuredClone(pending?.sent || payload);update({sent,saving:true,error:'',current:null});
  try{
    const row=verifyRecoveredDraft(await api.request('reading/draft',{},sent),context);
    if(row.id!=='urn:research:draft:'+sent.draft_uuid || row.revision!==sent.expected_revision+1 || ['body','mark_style','state','base_revision','document_id','annotation_id','text_sha256','exact','capture_kind'].some(key=>row[key]!==sent[key]) || row.start_pos!==sent.start || row.end_pos!==sent.end)throw new Error('Draft acknowledgement did not match the saved version.');
    return row;
  }catch(error){
    if(error.status===409 && error.current){try{verifyRecoveredDraft(error.current,context);update({sent,saving:false,error:'Another device saved a different draft. Both versions are shown below.',current:error.current});return null;}catch{}}
    const rejected=!pending?.sent && [400,404,413,422].includes(error.status);
    update({sent:rejected ? null : sent,saving:false,error:rejected ? 'The draft was rejected. Check its saved source and try again.' : 'The save was not confirmed. Your exact draft request is retained; retry it before changing this save.',current:null});return null;
  }
}
