/** Validate private saved reading identity before reopening a source. */
export function verifyReadingPlace(row,projectId) {
  if(row?.project_id!==projectId || !row.record_id || !row.document_id || !Number.isInteger(row.revision) || row.revision<1 ||
    !Number.isInteger(row.start_pos) || !Number.isInteger(row.end_pos) || row.start_pos<0 || row.end_pos<row.start_pos)throw new Error('The saved reading place did not match this project.');
  return row;
}

/** Retry precisely the original bookmark CAS after an unknown transport result. */
export async function saveReadingPlace({api,projectId,place,revision,draft,update}) {
  const sent=structuredClone(draft?.sent || {project_id:projectId,record_id:place.record_id,document_id:place.document_id,annotation_id:place.annotation_id || null,expected_revision:revision});
  update({sent,saving:true,error:'',current:null});
  try{
    const row=verifyReadingPlace(await api.request('reading/desk',{},sent),projectId);
    if(row.record_id!==sent.record_id || row.document_id!==sent.document_id || (row.annotation_id || null)!==sent.annotation_id || row.revision!==sent.expected_revision+1 || (!sent.annotation_id && (row.start_pos!==0 || row.end_pos!==0)))throw new Error('The saved reading position did not match the request.');
    return row;
  }catch(error){
    if(error.status===409 && error.current){
      try {verifyReadingPlace(error.current,projectId);update({sent,saving:false,current:error.current,error:'Another device saved a different reading place. Choose which bookmark to keep.'});return null;}catch{}
    }
    const rejected=!draft?.sent && [400,404,413,422].includes(error.status);
    update({sent:rejected ? null : sent,saving:false,current:null,error:rejected ? 'This bookmark was rejected. Reopen a saved excerpt and try again.' : 'The bookmark save was not confirmed. Retry the original bookmark before saving a different place.'});return null;
  }
}
