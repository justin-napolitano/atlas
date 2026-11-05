/** Validate the bounded provider resource without normalizing its Arabic text. */
export async function verifyPilotResource(resource) {
  if(!resource || typeof resource.resource_id!=='string' || !resource.resource_id || typeof resource.label!=='string' ||
    typeof resource.source_notice!=='string' || !resource.source_notice || typeof resource.reading_note!=='string' ||
    typeof resource.review_limit!=='string' || !Array.isArray(resource.verses) || resource.verses.length!==2) throw new Error('The identified pilot resource could not be verified.');
  const attribution=new URL(resource.attribution_url);
  if(attribution.protocol!=='https:' || attribution.hostname!=='tanzil.net' || attribution.username || attribution.password) throw new Error('The provider attribution link could not be verified.');
  const references=new Set();
  for(const verse of resource.verses) {
    if(verse.chapter!==4 || ![59,83].includes(verse.ayah_start) || verse.ayah_end!==verse.ayah_start ||
      typeof verse.text!=='string' || !verse.text || !verse.reference?.id || !verse.reference?.label) throw new Error('The pilot verse identity did not match the bounded resource.');
    const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verse.text)))].map(byte=>byte.toString(16).padStart(2,'0')).join('');
    if(digest!==verse.text_sha256 || references.has(verse.ayah_start)) throw new Error('The pilot text did not match its declared source bytes.');
    references.add(verse.ayah_start);
  }
  return resource;
}

/** Keep an unconfirmed owner write immutable across navigation and exact retries. */
export async function savePilotWrite({api,path,form,payload,update,verify}) {
  const sent=JSON.parse(JSON.stringify(form.sent || payload));
  update({...form,sent,saving:true,error:''});
  try {
    const result=await api.post(path,sent);
    await verify(result,sent);
    return result;
  } catch(error) {
    const rejected=!form.sent && [400,413,422].includes(error.status);
    update({...form,sent:rejected ? null : sent,saving:false,error:rejected ? 'The request was rejected. Check the fields and try again; your draft remains here.' :
      'The save was not confirmed. Your original request is retained; retry it before editing. A cloud copy may already exist.'});
    return null;
  }
}

/** Verify the imported verse through its saved immutable document and annotation. */
export async function verifyPilotImport(api,result,sent,resource) {
  if(result?.project_id!==sent.project_id || result.resource_id!==resource.resource_id || !result.record_id || !result.document_id || !result.annotation_id || !result.material_id) throw new Error('The imported verse identity was not confirmed.');
  const verse=resource.verses.find(row=>row.chapter===sent.chapter && row.ayah_start===sent.ayah);
  const [document,capture]=await Promise.all([
    api.request('reading/document',{project_id:sent.project_id,document_id:result.document_id}),
    api.request('reading/annotation',{project_id:sent.project_id,annotation_id:result.annotation_id})]);
  if(!verse || document.id!==result.document_id || document.project_id!==sent.project_id || document.source_record_id!==result.record_id ||
    document.text_body!==verse.text || document.text_sha256!==verse.text_sha256 || !document.source_notice?.includes(resource.source_notice) ||
    capture.annotation?.id!==result.annotation_id || capture.annotation.project_id!==sent.project_id || capture.annotation.document_id!==result.document_id ||
    capture.annotation.text_sha256!==verse.text_sha256 || capture.annotation.exact!==verse.text || !capture.anchor?.anchored) throw new Error('The saved Arabic copy did not match the identified verse and source notice.');
}

/** Refuse foreign or unrelated verse rows before presenting their private excerpts. */
export function verifyVerseRows(rows,projectId,chapter,start,end) {
  if(!Array.isArray(rows) || rows.some(row=>row.project_id!==projectId || row.chapter!==chapter || !Number.isInteger(row.ayah_start) || !Number.isInteger(row.ayah_end) || row.ayah_start<1 || row.ayah_end<row.ayah_start || row.ayah_start>end || row.ayah_end<start ||
    !row.source_record_id || !row.annotation_id || !row.document_id || !row.reference?.label)) throw new Error('Related material did not match this project and verse range.');
  return rows;
}
