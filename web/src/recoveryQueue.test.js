import test from 'node:test';
import assert from 'node:assert/strict';
import {RecoveryQueue} from './recoveryQueue.js';

const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
test('serial recovery protects newer edits while an older acknowledgement is delayed',async()=>{
  const writes=[];let release;
  const queue=new RecoveryQueue({identity:'synthetic',delay:100000,maxDelay:100000,write:sent=>{writes.push(sent);return new Promise(resolve=>{release=()=>resolve({revision:sent.expected_revision+1});});}});
  queue.enqueue({value:{body:'First'},state:'active'});const saving=queue.flush();
  queue.enqueue({value:{body:'Second'},state:'active'});await queue.flush();assert.equal(writes.length,1);
  release();await tick();assert.equal(writes.length,2);assert.equal(writes[1].value.body,'Second');assert.equal(writes[1].expected_revision,1);
  release();await saving;assert.equal(queue.status.phase,'saved');assert.equal(queue.revision,2);
});
test('lost acknowledgements retry the exact request before newer writing',async()=>{
  const writes=[];let fail=true;
  const queue=new RecoveryQueue({identity:'synthetic',delay:100000,maxDelay:100000,write:async sent=>{writes.push(sent);if(fail){fail=false;throw new Error('Lost acknowledgement');}return {revision:sent.expected_revision+1};}});
  queue.enqueue({body:'Original',state:'active'});await queue.flush();assert.equal(queue.status.phase,'error');
  queue.enqueue({body:'Newer',state:'active'});await queue.flush();assert.equal(writes.length,1);
  await queue.retry();assert.deepEqual(writes[0],writes[1]);assert.equal(writes[2].body,'Newer');assert.equal(writes[2].expected_revision,1);assert.equal(queue.status.phase,'saved');
});
test('finishing during a pending save serializes discard after the active copy',async()=>{
  const writes=[];let release;
  const queue=new RecoveryQueue({identity:'synthetic',delay:100000,maxDelay:100000,write:sent=>{writes.push(sent);return new Promise(resolve=>{release=()=>resolve({revision:sent.expected_revision+1});});}});
  queue.enqueue({value:{body:'Confirmed later'},state:'active'});const saving=queue.flush();queue.finish();
  release();await tick();assert.equal(writes[1].state,'discarded');release();await saving;assert.equal(queue.status.row.revision,2);
});
test('continuous editing has a bounded autosave delay',async t=>{
  t.mock.timers.enable({apis:['setTimeout','Date'],now:0});
  let firstWrite;
  const queue=new RecoveryQueue({identity:'synthetic',delay:50,maxDelay:25,write:async sent=>{firstWrite ??= Date.now();return {revision:sent.expected_revision+1};}});
  queue.enqueue({body:'a'});
  for(let n=0;n<5;n++){t.mock.timers.tick(5);queue.enqueue({body:String(Date.now())});}
  await Promise.resolve();await queue.flush();assert.equal(firstWrite,25);assert.ok(queue.revision>=1);
});
