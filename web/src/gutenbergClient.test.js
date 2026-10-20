import test from 'node:test';
import assert from 'node:assert/strict';
import {gutenbergReaderAPI,gutenbergPlaceWriter} from './gutenbergClient.js';
const target={project_id:'synthetic',book_id:1497},version='a'.repeat(64);
const point={version,section:2,position:40};
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('catalog browsing needs no save; first notes use atomic server endpoints',async()=>{
  const calls=[],api={async request(...args){calls.push(args);return {items:[]};},async post(...args){calls.push(args);return {};}};
  const binding={...target,version,section:2},doc={id:'doc',source_record_id:'source',text_sha256:'hash'};
  const reader=gutenbergReaderAPI(api,binding,doc);
  assert.deepEqual((await reader.request('reading/documents')).items,[doc]);
  assert.equal((await reader.request('reading/document',{document_id:'doc'})).id,'doc');
  assert.equal(calls.length,0);
  await reader.post('reading/annotations',{body:'note'});
  assert.deepEqual(calls[0],['catalog/gutenberg/annotations',{binding,annotation:{body:'note'}}]);
  await reader.post('notebook/entries',{body:'free thought'});
  assert.equal(calls[1][0],'catalog/gutenberg/notes');
  await assert.rejects(reader.request('reading/document',{document_id:'different'}));
});

test('lost reading-place response retries the same payload before newer scrolling',async()=>{
  const requests=[];let fail=true,release;
  const api={async request(path,query,value){requests.push({...value});if(fail){fail=false;throw new Error('Synthetic lost response');}return {...value,revision:value.expected_revision+1};}};
  const writer=gutenbergPlaceWriter(api,target,null);
  writer.move(point);await tick();
  assert.ok(writer.state().error);
  writer.move({...point,position:80});
  assert.equal(requests.length,1);
  await writer.retry();
  assert.deepEqual(requests[1],requests[0]);
  assert.equal(requests[2].position,80);
  assert.equal(requests[2].expected_revision,1);
  assert.equal(writer.state().cloud.position,80);
  assert.equal(writer.state().sent,null);
});

test('competing reading place is never silently overwritten',async()=>{
  const remote={...target,...point,revision:4};
  const writer=gutenbergPlaceWriter({async request(){throw Object.assign(new Error('Competing device'),{status:409,current:remote});}},target,null);
  writer.move({...point,position:90});await tick();
  assert.equal(writer.state().current.revision,4);
  writer.move({...point,position:99});
  assert.equal(writer.keepRemote().position,40);
  assert.equal(writer.state().next,null);
});
