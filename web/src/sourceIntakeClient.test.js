import test from 'node:test';
import assert from 'node:assert/strict';
import {saveSourceIntake,sourceIntakePayload,verifySourceIntake} from './sourceIntakeClient.js';

const form={intake_uuid:'synthetic-request',title:'A source',creators:'Author',publication:'Publisher',publication_date:'2026',edition:'Edition 1',
  identifier:'10.1234/test',source_url:'https://example.invalid/source',source_role:'scholarship',access_status:'unknown',rights_status:'permitted_excerpt',rights_basis:'Synthetic fixture',
  coverage_scope:'selected_passage',rationale:'Research question',distinct_source_rationale:'',existing_source_record_id:'',include_excerpt:true,text:'😀 tafsīr\r\nEvidence.',locator:'Section 2',step:3,confirmed:true};
const result={project_id:'project',record_id:'source',document_id:'document'};
const record={id:'source',project_id:'project',kind:'source'};
const doc={id:'document',project_id:'project',source_record_id:'source',edition:'Edition 1',locator:'Section 2',representation_url:form.source_url,text_body:'😀 tafsīr\nEvidence.'};
const api={request:async path=>path==='record' ? record : doc};

test('payload sends explicit source declarations without UI state; metadata fallback omits text',()=>{
  const value=sourceIntakePayload(form,'project');
  assert.equal(value.owner_confirmed,true);assert.equal(value.existing_source_record_id,null);assert.equal(value.step,undefined);
  assert.equal(value.excerpt.text,form.text);assert.equal(sourceIntakePayload({...form,include_excerpt:false},'project').excerpt,null);
});

test('readback verifies project, source, original wording, edition, and locator',async()=>{
  const sent=sourceIntakePayload(form,'project');await verifySourceIntake(api,result,sent);
  for(const patch of [{project_id:'other'},{source_record_id:'other'},{text_body:'Changed text'},{edition:'Edition 2'},{locator:'Elsewhere'}])
    await assert.rejects(verifySourceIntake({request:async path=>path==='record' ? record : {...doc,...patch}},result,sent));
  await assert.rejects(verifySourceIntake(api,{...result,project_id:'other'},sent));
  await assert.rejects(verifySourceIntake(api,result,{...sent,existing_source_record_id:'other'}));
});

test('lost response freezes exact original request; retry confirms same receipt and source',async()=>{
  const updates=[],sent=sourceIntakePayload(form,'project');let current=form;
  const update=value=>{current=value;updates.push(value);};
  await saveSourceIntake({api:{post:async()=>{throw new Error('Lost response');}},form:current,payload:sent,update});
  assert.deepEqual(current.sent,sent);assert.equal(current.saving,false);
  let posted;
  const saved=await saveSourceIntake({api:{...api,post:async(_path,value)=>{posted=value;return result;}},form:current,payload:{...sent,title:'Must not replace uncertain input'},update});
  assert.deepEqual(posted,sent);assert.deepEqual(saved,result);
});

test('known initial rejection allows correction; rejection after uncertain save stays frozen',async()=>{
  const sent=sourceIntakePayload(form,'project');let current;
  const rejected={post:async()=>{throw {status:422};}};
  await saveSourceIntake({api:rejected,form,payload:sent,update:value=>{current=value;}});assert.equal(current.sent,null);
  await saveSourceIntake({api:rejected,form:{...form,sent},payload:sent,update:value=>{current=value;}});assert.deepEqual(current.sent,sent);
});

test('incorrect successful response cannot clear a draft or navigate to unrelated source',async()=>{
  const sent=sourceIntakePayload(form,'project');let current;
  const saved=await saveSourceIntake({api:{...api,post:async()=>({...result,record_id:'unrelated'})},form,payload:sent,update:value=>{current=value;}});
  assert.equal(saved,null);assert.deepEqual(current.sent,sent);
});
