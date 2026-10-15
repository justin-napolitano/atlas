import test from 'node:test';
import assert from 'node:assert/strict';
import {draftRowPayload,recoveryContext,saveRecoverableDraft,verifyRecoveredDraft} from './recoverableDraftClient.js';
const uuid='12345678-1234-4123-8123-123456789012';
const context={project_id:'p',record_id:'s',context_kind:'capture',document_id:'d',annotation_id:null,text_sha256:'a'.repeat(64),start:2,end:8,exact:'tafsīr',capture_kind:'comment',base_revision:0};
const payload={...context,draft_uuid:uuid,body:'My unfinished note 😀',mark_style:'underline',state:'active',expected_revision:0};
const row={...payload,id:'urn:research:draft:'+uuid,start_pos:2,end_pos:8,revision:1,base_snapshot:{}};

test('recovery context keeps exact Unicode source and historical baseline separate from writing',()=>{
  const value=recoveryContext({projectId:'p',recordId:'s',contextKind:'annotation',document:{id:'d',text_sha256:'a'.repeat(64)},annotation:{id:'a',revision:3,start_pos:2,end_pos:8,exact:'tafsīr',capture_kind:'comment'}});
  assert.equal(value.annotation_id,'a');assert.equal(value.base_revision,3);assert.equal(value.start,2);assert.equal(value.exact,'tafsīr');
  const general=recoveryContext({projectId:'p',recordId:'concept',contextKind:'record_note',baseRevision:9});assert.equal(general.document_id,null);assert.equal(general.base_revision,9);assert.equal(general.exact,'');
});
test('readback requires same project/record/document/hash and exact saved annotation selector',()=>{
  assert.equal(verifyRecoveredDraft(row,context),row);
  for(const patch of [{project_id:'other'},{record_id:'other'},{document_id:'other'},{text_sha256:'b'.repeat(64)},{end_pos:9}])assert.throws(()=>verifyRecoveredDraft({...row,...patch},context));
  const annotationContext={...context,context_kind:'annotation',annotation_id:'a'},annotationRow={...row,context_kind:'annotation',annotation_id:'a'};
  assert.throws(()=>verifyRecoveredDraft({...annotationRow,start_pos:3,end_pos:9},annotationContext));
});
test('unknown draft saves retain the exact body/style/UUID/revision despite caller edits',async()=>{
  let pending,calls=[];const update=value=>{pending=value;};
  const api={request:async(path,params,sent)=>{calls.push(sent);if(calls.length===1)throw {status:503};return row;}};
  assert.equal(await saveRecoverableDraft({api,payload,context,update}),null);
  const result=await saveRecoverableDraft({api,payload:{...payload,body:'changed',draft_uuid:crypto.randomUUID()},pending,context,update});
  assert.equal(result,row);assert.deepEqual(calls[0],calls[1]);assert.equal(calls[1].body,payload.body);
});
test('another-device conflict retains local and cloud versions without overwriting either',async()=>{
  let value;const current={...row,revision:2,body:'Cloud unfinished writing'};
  await saveRecoverableDraft({api:{request:async()=>{throw {status:409,current};}},payload,context,update:next=>{value=next;}});
  assert.equal(value.current.body,'Cloud unfinished writing');assert.equal(value.sent.body,payload.body);assert.equal(value.sent.expected_revision,0);
  const fork={...value.sent,draft_uuid:crypto.randomUUID(),expected_revision:0};assert.notEqual(fork.draft_uuid,value.current.id.slice('urn:research:draft:'.length));
});
test('wrong successful acknowledgement stays uncertain; only initial validation can unlock fields',async()=>{
  let value;const update=next=>{value=next;};
  await saveRecoverableDraft({api:{request:async()=>({...row,body:'unrelated'})},payload,context,update});assert.ok(value.sent);
  await saveRecoverableDraft({api:{request:async()=>{throw {status:422};}},payload,pending:value,context,update});assert.ok(value.sent);
  await saveRecoverableDraft({api:{request:async()=>{throw {status:422};}},payload,context,update});assert.equal(value.sent,null);
});
test('discard and restore use the complete immutable context but omit server-controlled baseline content',()=>{
  const value=draftRowPayload({...row,state:'discarded',revision:4});assert.equal(value.expected_revision,4);assert.equal(value.state,'discarded');assert.equal(value.draft_uuid,uuid);
  assert.equal(value.base_snapshot,undefined);assert.equal(value.id,undefined);assert.equal(value.start,2);
});
