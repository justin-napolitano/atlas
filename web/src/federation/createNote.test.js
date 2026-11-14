import test from 'node:test';import assert from 'node:assert/strict';import {CreateNoteIntent} from './createNote.js';
test('lost creation response retries the same target and exact intent once',async()=>{
 const calls=[];let lost=true;const client={page:(a,b,p)=>`${a}/${b}/${p}`,request:async(path,body)=>{calls.push({path,body:structuredClone(body)});if(lost){lost=false;throw Error('response lost');}return {page_id:path.split('/').at(-2),version:1};}};
 const session=new CreateNoteIntent(client,'alice','brain');await assert.rejects(session.create());const pending=session.pending;const row=await session.create();assert.deepEqual(calls[0],calls[1]);assert.equal(row.page_id,pending.page_id);assert.equal(session.pending,null);
});
