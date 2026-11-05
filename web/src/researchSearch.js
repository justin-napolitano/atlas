export const searchScopes=[['all','All'],['sources','Sources'],['passages','Passages'],['notes','Notes'],['concepts','Concepts'],['questions','Questions']];
const kinds=new Set(['record','document','passage_note','record_note','thought','concept','definition']);
export function verifySearch(page,projectId){
  if(!page || !Array.isArray(page.items) || page.items.length>50 || typeof page.truncated!=='boolean' || page.items.some(row=>!row || row.project_id!==projectId || !kinds.has(row.kind) || typeof row.id!=='string' || typeof row.title!=='string' || typeof row.excerpt!=='string'))throw new Error('Search did not return a matching project response. Please try again.');
  return page;
}
export function inSearchScope(row,scope){return scope==='all' || scope==='sources'&&(row.kind==='document'||row.kind==='record'&&['source','work','edition'].includes(row.record_kind)) || scope==='passages'&&['document','passage_note'].includes(row.kind) || scope==='notes'&&['record_note','passage_note','thought'].includes(row.kind) || scope==='concepts'&&['concept','definition'].includes(row.kind) || scope==='questions'&&(row.kind==='thought'&&row.thought_type==='question'||row.kind==='record'&&row.record_kind==='question');}
export function searchResultLabel(row){if(row.kind==='record' && row.record_kind)return row.record_kind==='source'?'Source':row.record_kind[0].toUpperCase()+row.record_kind.slice(1);return {record:'Source or research record',document:'Source passage',passage_note:'Passage note',record_note:'Reading note',thought:row.thought_type==='question'?'Question':'Notebook thought',concept:'Concept',definition:'Located definition'}[row.kind] || 'Research result';}
export function searchDestination(row){
  if(row.kind==='thought' && row.entry_id)return {kind:'notebook',entryId:row.entry_id};
  if(row.kind==='concept' && (row.concept_id || row.record_id))return {kind:'source',recordId:row.concept_id || row.record_id,annotationId:'',documentId:''};
  if(row.record_id)return {kind:'source',recordId:row.record_id,annotationId:row.annotation_id || '',documentId:row.document_id || ''};
  if(row.concept_id)return {kind:'source',recordId:row.concept_id,annotationId:'',documentId:''};
  return null;
}
