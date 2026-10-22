/** Notebook drafts remain in the shared page-memory map; server rows are authoritative. */
export const thoughtTypes=['note','question','source_claim','interpretation','objection','decision','principle','skill'];
export const thoughtLabel=kind=>({note:'Note',question:'Question',source_claim:'Source claim to check',interpretation:'My interpretation',objection:'Objection',decision:'Decision',principle:'Principle',skill:'Skill',passage_note:'Passage note',record_note:'Reading record note'}[kind] || kind);
export const notebookKey=(projectId,id='new')=>`notebook:${JSON.stringify([projectId,id])}`;
export const notebookMetadata=row=>Object.fromEntries(['thought_type','title','body','links','state'].map(key=>[key,key==='links'?(row.links || []).map(({kind,id,rationale})=>({kind,id,rationale})):row[key] ?? (key==='state'?'active':'')]));
export function newThought(anchor={}){return {request_uuid:crypto.randomUUID(),thought_type:'note',title:'',body:'',links:[],state:'active',
  record_id:anchor.record_id || null,document_id:anchor.document_id || null,annotation_id:anchor.annotation_id || null,...(anchor.reading_position!=null?{reading_position:anchor.reading_position}:{})};}
export function verifyThought(row,projectId,id){
  if(!row || row.id!==id || row.project_id!==projectId || !Number.isInteger(row.revision) || row.revision<1 || !thoughtTypes.includes(row.thought_type) || !['active','withdrawn'].includes(row.state))throw new Error('Notebook response did not match the selected thought. Your draft is retained.');
  return row;
}
function sameMetadata(a,b){return JSON.stringify(notebookMetadata(a))===JSON.stringify(notebookMetadata(b));}
export async function saveThought({api,projectId,id,draft,update}){
  const sent=draft.sent || (id ? {entry_id:id,project_id:projectId,expected_revision:draft.base.revision,...notebookMetadata(draft.value),owner_confirmed:true}
    : {project_id:projectId,request_uuid:draft.value.request_uuid,...notebookMetadata(draft.value),record_id:draft.value.record_id,document_id:draft.value.document_id,annotation_id:draft.value.annotation_id,...(draft.value.reading_position!=null?{reading_position:draft.value.reading_position}:{}),owner_confirmed:true});
  if(!id)delete sent.state;
  update({...draft,sent,saving:true,error:'',current:null});
  try{
    const result=id ? await api.request('notebook/entry',{},sent) : await api.post('notebook/entries',sent);
    const entryId=id || `urn:research:notebook:${sent.request_uuid}`;
    if(result.project_id!==projectId || result.id!==entryId)throw new Error('Notebook save returned another target.');
    const row=id ? result : await api.request('notebook/entry',{project_id:projectId,entry_id:entryId});
    verifyThought(row,projectId,entryId);
    if(id && (row.revision!==sent.expected_revision+1 || !sameMetadata(row,sent)))throw new Error('Notebook save did not confirm your exact revision.');
    if(!id && (row.record_id!==sent.record_id || row.document_id!==sent.document_id || row.annotation_id!==sent.annotation_id || (row.reading_position ?? null)!==(sent.reading_position ?? null)))throw new Error('Notebook source anchor changed.');
    if(!id && !sameMetadata(row,{...sent,state:'active'})){
      update({...draft,saving:false,sent,current:row,error:'The thought was created, then changed. Compare your original draft with its current revision.'});return null;
    }
    return row;
  }catch(error){
    let current=null;
    if(error.status===409 && error.current){try{current=verifyThought(error.current,projectId,id || error.current.id);}catch{}}
    const definitive=[400,413,422].includes(error.status) && !draft.sent;
    update({...draft,saving:false,sent:definitive?null:sent,current,error:error.message || 'Could not confirm the save. Your original draft is retained.'});return null;
  }
}
