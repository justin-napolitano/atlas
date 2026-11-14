import test from 'node:test';
import assert from 'node:assert/strict';
import { searchWorkspace } from './sourceClient.js';

test('source projection is disabled by default and never queries another account',async()=>{
  const calls=[];const client={profile:account=>`accounts/${account}`,request:async(path,body)=>{calls.push({path,body});return {total:1,items:[]};}};
  const value=await searchWorkspace(client,'alice','exact query',false);
  assert.equal(calls.length,1);assert.equal(calls[0].path,'accounts/alice/search');assert.equal(value.sources,null);
});
test('permitted source and note results remain independent on partial failure',async()=>{
  const calls=[];const client={profile:account=>`accounts/${account}`,request:async(path,body)=>{calls.push({path,body});if(path.endsWith('/sources/search'))throw Error('source service down');return {total:2,items:[]};}};
  const value=await searchWorkspace(client,'bob','日本語\r\n',true);
  assert.equal(value.notes.total,2);assert.equal(value.sources,null);assert(value.sourceError);assert.equal(value.noteError,'');
  assert.deepEqual(calls[1],{path:'accounts/bob/sources/search',body:{query:'日本語\r\n',brain_id:null,limit:20,offset:0}});
});
test('unavailable note search cannot hide successful zero source count',async()=>{
  const client={profile:account=>`accounts/${account}`,request:async path=>{if(!path.endsWith('/sources/search'))throw Error('notes down');return {total:0,items:[],coverage:{complete:false}};}};
  const value=await searchWorkspace(client,'bob','synthetic',true);
  assert.equal(value.notes,null);assert(value.noteError);assert.equal(value.sources.total,0);assert.equal(value.sourceError,'');
});
