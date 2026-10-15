import test from 'node:test';
import assert from 'node:assert/strict';
import {saveReadingPlace,verifyReadingPlace} from './readingPlace.js';
const place={record_id:'source',document_id:'document',annotation_id:'annotation'};
const row={...place,project_id:'project',start_pos:4,end_pos:9,revision:1};

test('reading place rejects foreign project, invalid revision and impossible ranges',()=>{
  assert.equal(verifyReadingPlace(row,'project'),row);
  for(const patch of [{project_id:'other'},{revision:0},{start_pos:10,end_pos:9},{document_id:''}])assert.throws(()=>verifyReadingPlace({...row,...patch},'project'));
});
test('bookmark retry cannot change source, annotation or last confirmed revision',async()=>{
  let draft;const update=value=>{draft=value;},calls=[];
  const api={request:async(path,params,value)=>{calls.push(value);if(calls.length===1)throw {status:503};return row;}};
  assert.equal(await saveReadingPlace({api,projectId:'project',place,revision:0,update}),null);
  assert.ok(draft.sent);const saved=await saveReadingPlace({api,projectId:'project',place:{record_id:'other',document_id:'other'},revision:9,draft,update});
  assert.deepEqual(saved,row);assert.deepEqual(calls[0],calls[1]);
});
test('bookmark conflict retains both exact requested and cloud identities',async()=>{
  let draft;const current={...row,record_id:'cloud-source',revision:2};
  await saveReadingPlace({api:{request:async()=>{throw {status:409,current};}},projectId:'project',place,revision:0,update:value=>{draft=value;}});
  assert.equal(draft.current,current);assert.equal(draft.sent.record_id,'source');assert.equal(draft.sent.expected_revision,0);
});
test('mismatched bookmark acknowledgement remains uncertain; excerpt start is explicit',async()=>{
  let draft;const update=value=>{draft=value;};
  const result=await saveReadingPlace({api:{request:async()=>({...row,annotation_id:'other'})},projectId:'project',place,revision:0,update});
  assert.equal(result,null);assert.ok(draft.sent);
  const start={...row,annotation_id:null,start_pos:0,end_pos:0};
  assert.deepEqual(await saveReadingPlace({api:{request:async()=>start},projectId:'project',place:{...place,annotation_id:null},revision:0,update}),start);
});
