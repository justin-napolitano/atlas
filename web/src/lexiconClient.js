// Private page-memory drafts. Creation retries retain the exact submitted payload.
export const definitionKinds = {
  source_explicit:'Definition explicitly stated by the source',
  reference_gloss:'Dictionary or reference gloss',
  owner_paraphrase:'My attributed paraphrase',
  machine_proposed:'Machine proposal · unreviewed',
};
export const lexicalKey=(project,id,kind)=>`lexicon:${JSON.stringify([project,id,kind])}`;
export const appendLexicalPage=(rows,next)=>[...new Map([...rows,...next].map(row=>[row.id,row])).values()];
export function mergeResearchMatches(records,lexical) {
  const result=new Map(records.map(row=>[row.id,{...row,matches:[...(row.matches || [])]}]));
  for(const row of lexical) {
    const current=result.get(row.id) || {...row,kind:'concept',matches:[]};
    if(current.project_id!==row.project_id)throw new Error('Search results mixed project identities');
    current.matches=[...current.matches,{channel:'lexicon',target_id:row.match_id,excerpt:row.original,
      assertion_kind:row.assertion_kind}];result.set(row.id,current);
  }
  return [...result.values()];
}
const copy=value=>JSON.parse(JSON.stringify(value));

export async function saveCreation({api,drafts,key,form,payload,path,validate,changed}) {
  if(drafts.current.get(key)?.saving) return null;
  const sent=copy(form.sent || payload);
  drafts.current.set(key,{...form,saving:true,sent,error:''});changed();
  try {
    const value=await api.post(path,sent);
    await validate(value,sent);
    drafts.current.delete(key);changed();return value;
  } catch(error) {
    const rejected=!form.sent && [400,413,422].includes(error.status);
    drafts.current.set(key,{...form,saving:false,sent:rejected ? null : sent,
      error:rejected ? 'Check the required fields, language/script declarations, and source wording. The request was rejected; your draft is here.'
        : 'The save could not be confirmed. Your exact request is retained; retry it before changing this draft.'});
    changed();return null;
  }
}

export function exportLexiconDraft(form) {
  const url=URL.createObjectURL(new Blob([JSON.stringify({format:'private-lexicon-draft-1',draft:form},null,2)],{type:'application/json'}));
  const link=document.createElement('a');link.href=url;link.download='private-lexicon-draft.json';link.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}

export async function verifyCapture(api,value,sent,annotation) {
  for(const key of ['concept_id','sense_id','entry_id','form_id','representation_id','occurrence_id']) {
    if(typeof value?.[key]!=='string' || !value[key]) throw new Error('Incomplete lexical capture response');
  }
  const row=await api.request('lexicon/entity',{project_id:sent.project_id,entity_kind:'occurrence',entity_id:value.occurrence_id});
  if(row.id!==value.occurrence_id || row.project_id!==sent.project_id || row.annotation_id!==sent.annotation_id || row.document_id!==annotation.document_id ||
    row.text_sha256!==annotation.text_sha256 || row.term_start!==sent.start || row.term_end!==sent.end ||
    row.representation_id!==value.representation_id || row.sense_id!==value.sense_id ||
    row.exact!==Array.from(annotation.exact).slice(sent.start,sent.end).join('')) throw new Error('Capture response did not match the selected term');
  const [sense,representation]=await Promise.all([
    api.request('lexicon/entity',{project_id:sent.project_id,entity_kind:'sense',entity_id:value.sense_id}),
    api.request('lexicon/entity',{project_id:sent.project_id,entity_kind:'representation',entity_id:value.representation_id})]);
  if(sense.id!==value.sense_id || sense.project_id!==sent.project_id || sense.concept_id!==value.concept_id || sense.entry_id!==value.entry_id ||
    representation.id!==value.representation_id || representation.project_id!==sent.project_id || representation.form_id!==value.form_id || representation.written_rep!==row.exact) throw new Error('Lexical response did not match the recorded concept and spelling');
}

export function verifyDefinition(row,sent) {
  if(row?.project_id!==sent.project_id || row.annotation_id!==sent.annotation_id || row.concept_id!==sent.concept_id ||
    row.definition_kind!==sent.definition_kind || row.body!==sent.body || row.wording_mode!==sent.wording_mode ||
    row.revision!==1 || typeof row.id!=='string' ||
    ['attribution','scope','dating_note','rationale','proposal_tool','proposal_version','proposal_activity'].some(key=>sent[key]!==undefined && row[key]!==sent[key])) throw new Error('Definition response did not match the selected source');
}
