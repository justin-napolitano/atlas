import test from 'node:test';
import assert from 'node:assert/strict';
import {lexicalKey,mergeResearchMatches,saveCreation,verifyCapture,verifyDefinition} from './lexiconClient.js';

const base=()=>({rationale:'My retained private rationale',request_uuid:'synthetic-retained-uuid'});
test('uncertain creation retries retain the exact request even if a caller supplies changed fields',async()=>{
  const drafts={current:new Map()},requests=[],key=lexicalKey('project','annotation','capture');let fail=true;
  const api={post:async(path,value)=>{requests.push(value);if(fail)throw new Error('Lost response');return {id:'synthetic'};}};
  const payload={request_uuid:'synthetic-retained-uuid',project_id:'project',annotation_id:'annotation',rationale:'Original intent'};
  const args={api,drafts,key,form:base(),payload,path:'lexicon/captures',validate:()=>{},changed:()=>{}};
  assert.equal(await saveCreation(args),null);
  assert.deepEqual(drafts.current.get(key).sent,payload);
  fail=false;
  await saveCreation({...args,form:drafts.current.get(key),payload:{...payload,rationale:'Changed intent'}});
  assert.deepEqual(requests,[payload,payload]);assert.equal(drafts.current.has(key),false);
});

test('initial validation rejection preserves an editable draft; a rejection after uncertainty stays locked',async()=>{
  const drafts={current:new Map()},key='synthetic',form=base();
  const api={post:async()=>{throw Object.assign(new Error('Rejected'),{status:422});}};
  const args={api,drafts,key,form,payload:{request_uuid:form.request_uuid},path:'lexicon/definitions',validate:()=>{},changed:()=>{}};
  await saveCreation(args);assert.equal(drafts.current.get(key).sent,null);
  assert.equal(drafts.current.get(key).rationale,form.rationale);
  const sent={request_uuid:form.request_uuid};await saveCreation({...args,form:{...form,sent}});
  assert.deepEqual(drafts.current.get(key).sent,sent);
});

test('a committed-looking response with a mismatched source remains uncertain and retains its draft',async()=>{
  const drafts={current:new Map()},key='synthetic',sent={project_id:'project',annotation_id:'annotation',concept_id:'concept',definition_kind:'owner_paraphrase',wording_mode:'paraphrase',body:'Original meaning'};
  await saveCreation({api:{post:async()=>({...sent,project_id:'wrong',id:'definition',revision:1})},drafts,key,form:base(),payload:sent,path:'lexicon/definitions',validate:verifyDefinition,changed:()=>{}});
  assert.deepEqual(drafts.current.get(key).sent,sent);
  assert.equal(drafts.current.get(key).rationale,base().rationale);
});

test('term verification binds Unicode positions, quotation identity, snapshot and chosen sense',async()=>{
  const annotation={exact:'😀 tafsīr',document_id:'document',text_sha256:'hash'};
  const sent={project_id:'project',annotation_id:'annotation',start:2,end:8};
  const value={concept_id:'concept',sense_id:'sense',entry_id:'entry',form_id:'form',representation_id:'representation',occurrence_id:'occurrence'};
  const row={...sent,id:'occurrence',document_id:'document',text_sha256:'hash',term_start:2,term_end:8,exact:'tafsīr',representation_id:'representation',sense_id:'sense'};
  const linked={sense:{id:'sense',project_id:'project',concept_id:'concept',entry_id:'entry'},representation:{id:'representation',project_id:'project',form_id:'form',written_rep:'tafsīr'}};
  const api={request:async(path,params)=>params.entity_kind==='occurrence' ? row : linked[params.entity_kind]};await verifyCapture(api,value,sent,annotation);
  for(const patch of [{project_id:'wrong'},{annotation_id:'wrong'},{term_start:3},{text_sha256:'different'},{sense_id:'wrong'}]) {
    await assert.rejects(()=>verifyCapture({request:async()=>({...row,...patch})},value,sent,annotation));
  }
  await assert.rejects(()=>verifyCapture(api,{...value,concept_id:'wrong-concept'},sent,annotation));
});

test('draft identity distinguishes projects and creation/correction operations',()=>{
  assert.notEqual(lexicalKey('a','same','capture'),lexicalKey('b','same','capture'));
  assert.notEqual(lexicalKey('a','same','capture'),lexicalKey('a','same','definition-edit'));
});

test('combined research search preserves record order, both match channels and distinct concept identities',()=>{
  const records=[{id:'source',project_id:'p',matches:[{channel:'private_note',excerpt:'My note'}]},
    {id:'concept',project_id:'p',kind:'concept',matches:[]}];
  const lexical=[{id:'concept',project_id:'p',match_id:'definition',original:'Scoped wording',assertion_kind:'machine_proposed'},
    {id:'different-concept',project_id:'p',original:'Same spelling'}];
  const result=mergeResearchMatches(records,lexical);
  assert.deepEqual(result.map(row=>row.id),['source','concept','different-concept']);
  assert.equal(result[1].matches[0].assertion_kind,'machine_proposed');assert.equal(result[2].kind,'concept');
  assert.deepEqual(records[1].matches,[]);
  assert.throws(()=>mergeResearchMatches(records,[{id:'concept',project_id:'wrong'}]));
});
