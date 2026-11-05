import test from 'node:test';
import assert from 'node:assert/strict';
import {newThought,notebookKey,saveThought,verifyThought} from './notebookClient.js';
const projectId='synthetic:project';
const value=()=>({...newThought({record_id:'source',document_id:'document',annotation_id:'annotation'}),title:'My question',body:'😀 التفسير **tafsīr**'});
const rowFor=sent=>({...sent,id:`urn:research:notebook:${sent.request_uuid}`,revision:1,state:'active'});
test('notebook request identity survives an uncertain create and readback binds source',async()=>{
  let draft={value:value(),base:null},last;const update=row=>{draft=row;};
  await saveThought({api:{post:async()=>{throw {status:503};}},projectId,draft,update});
  const original=structuredClone(draft.sent);assert.equal(draft.saving,false);
  const row=await saveThought({api:{post:async(_path,sent)=>{last=sent;return rowFor(sent);},request:async()=>rowFor(original)},projectId,draft:{...draft,value:{...draft.value,body:'Changed caller body'}},update});
  assert.deepEqual(last,original);assert.equal(row.body,original.body);
  const bad=await saveThought({api:{post:async()=>rowFor(original),request:async()=>({...rowFor(original),annotation_id:'other'})},projectId,draft,update});
  assert.equal(bad,null);assert.deepEqual(draft.sent,original);
});
test('wrong creation identity, project and revision never clear a draft',async()=>{
  for(const patch of [{id:'another-entry'},{project_id:'other'},{revision:0}]){
    const draft={value:value(),base:null};let held;
    const saved=await saveThought({api:{post:async(_path,sent)=>({...rowFor(sent),...patch}),request:async(_path,params)=>({...rowFor({project_id,...draft.value}),...patch})},projectId,draft,update:v=>{held=v;}});
    assert.equal(saved,null);assert.ok(held.sent);
  }
  assert.throws(()=>verifyThought({id:'entry',project_id:'other',revision:1,thought_type:'note',state:'active'},projectId,'entry'));
  assert.notEqual(notebookKey(projectId,'entry'),notebookKey('other','entry'));
});
test('known first rejection unlocks a draft, but an uncertain retry remains frozen',async()=>{
  let held;const draft={value:value(),base:null},api={post:async()=>{throw {status:422};}},update=v=>{held=v;};
  await saveThought({api,projectId,draft,update});assert.equal(held.sent,null);
  const sent={...draft.value,project_id:projectId};await saveThought({api,projectId,draft:{...draft,sent},update});assert.deepEqual(held.sent,sent);
});
test('revision correction conflict retains both thoughts and lost acknowledgement retries exact CAS',async()=>{
  const base={...value(),id:'entry',project_id:projectId,revision:2},current={...base,revision:3,body:'Other device'};
  let held;const draft={value:{...base,body:'My correction'},base};
  await saveThought({api:{request:async()=>{throw {status:409,current};}},projectId,id:'entry',draft,update:v=>{held=v;}});
  assert.equal(held.current.body,'Other device');assert.equal(held.value.body,'My correction');
  let sent;const row=await saveThought({api:{request:async(_path,_params,v)=>{sent=v;return {...v,id:'entry',revision:3};}},projectId,id:'entry',draft:{...held,current:null},update:v=>{held=v;}});
  assert.equal(sent.expected_revision,2);assert.equal(row.body,'My correction');
});
