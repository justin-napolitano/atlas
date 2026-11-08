import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { ChatTurnSession, ChatSessionRegistry } from './chatSession.js';
import { BridgeError } from './client.js';
globalThis.crypto ||= webcrypto;
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const response=(version,conversation_id='synthetic-conversation')=>({version,conversation_id,turn_id:`turn-${version}`,message:'Synthetic response'});

test('one in-flight turn and immutable uncertain retry preserve newer versions',async()=>{
  const a=deferred();const requests=[];let next=a;
  const client={request:async(_path,body)=>{requests.push(body);return next.promise;}};const session=new ChatTurnSession();
  const sending=session.send(client,'path','first','page');assert.equal(await session.send(client,'path','duplicate','page'),null);assert.equal(requests.length,1);
  a.reject(new BridgeError('transfer_uncertain',503));await assert.rejects(sending);const pending=session.pending;
  next=deferred();const retry=session.send(client,'path','must not replace pending','page');assert.equal(requests[1],pending);next.resolve(response(1));await retry;
  assert.equal(session.pending,null);assert.equal(session.version,1);
  next=deferred();const second=session.send(client,'path','second','page');assert.equal(requests[2].expected_version,1);next.resolve(response(2));await second;assert.equal(session.version,2);
});
test('old scope response cannot acknowledge another selection of the same IDs',async()=>{
  const old=deferred(),session=new ChatTurnSession();const sending=session.send({request:()=>old.promise},'same/account/brain','retained','page');const pending=session.pending;session.invalidate();
  old.resolve(response(1));assert.equal(await sending,null);assert.equal(session.version,0);assert.equal(session.pending,pending);
});
test('wrong conversation or regressive receipt preserves exact pending operation',async()=>{
  const session=new ChatTurnSession();await session.send({request:async()=>response(1)},'path','first','page');
  await assert.rejects(session.send({request:async()=>response(2,'other-conversation')},'path','second','page'));const pending=session.pending;
  assert.equal(session.version,1);assert(pending);await assert.rejects(session.send({request:async()=>response(1)},'path','ignored','page'));assert.equal(session.pending,pending);
});
test('UTF-8 validation and terminal conflict do not freeze editable drafts',async()=>{
  const session=new ChatTurnSession();let calls=0;const client={request:async()=>{calls++;throw new BridgeError('conversation_conflict',409);}};
  await assert.rejects(session.send(client,'path','界'.repeat(1366),'page'));assert.equal(calls,0);assert.equal(session.pending,null);
  await assert.rejects(session.send(client,'path','valid draft','page'));assert.equal(session.pending,null);assert.equal(session.conflict,true);
  session.startNew();assert.equal(session.conflict,false);await session.send({request:async()=>response(1)},'path','valid draft','page');assert.equal(session.version,1);
});
test('navigation A to B to A retains one pending intent and rejects old view acknowledgements',async()=>{
  const changes=[],registry=new ChatSessionRegistry(()=>changes.push(registry.activeKey));const a=registry.select('alice/brain-a');a.setDraft('A exact retained draft');
  const oldView=registry.viewEpoch,reply=deferred(),requests=[];const client={request:async(_path,body)=>{requests.push(body);return reply.promise;}};
  const sending=a.send(client,'A',a.draft,'page-a');const original=a.pending;
  const b=registry.select('bob/brain-b');b.setDraft('B unsent draft');assert(registry.hasUnsent);
  assert.equal(registry.select('alice/brain-a'),a);assert.equal(a.pending,original);assert.equal(a.draft,'A exact retained draft');assert.equal(await a.send(client,'A','must not create another intent','page-a'),null);assert.equal(requests.length,1);
  reply.resolve(response(1));await sending;
  assert.equal(registry.matches('alice/brain-a',oldView),false);assert.equal(a.response.version,1);assert.equal(a.pending,null);assert.equal(b.draft,'B unsent draft');assert(registry.hasUnsent);
  registry.select('bob/brain-b');assert.equal(registry.current.draft,'B unsent draft');registry.current.setDraft('');assert.equal(registry.hasUnsent,false);
});
test('uncertain background turn restores original operation on return and never overwrites other draft',async()=>{
  const registry=new ChatSessionRegistry(),a=registry.select('A');a.setDraft('Exact A');const reply=deferred(),requests=[];
  const client={request:async(_path,body)=>{requests.push(body);return reply.promise;}};const sending=a.send(client,'A',a.draft,null);const pending=a.pending;
  registry.select('B').setDraft('Exact B');reply.reject(new BridgeError('transfer_uncertain',503));await assert.rejects(sending);
  assert.equal(registry.current.draft,'Exact B');assert.equal(registry.select('A').pending,pending);assert.equal(registry.current.draft,'Exact A');
  await a.send({request:async(_path,body)=>{assert.equal(body,pending);return response(1);}},'A','ignored newer draft',null);assert.equal(a.pending,null);
});
test('bounded memory registry refuses to evict unsent or uncertain scopes',()=>{
  const registry=new ChatSessionRegistry(()=>{},2);registry.select('A').setDraft('A unsent');registry.select('B').setDraft('B unsent');assert.throws(()=>registry.prepare('C'),/memory is full/);assert.equal(registry.scopes.get('A').draft,'A unsent');assert.equal(registry.scopes.get('B').draft,'B unsent');
  registry.current.setDraft('');registry.select('A');registry.prepare('C');assert.equal(registry.scopes.size,2);assert(registry.scopes.has('A'));assert(!registry.scopes.has('B'));
});
