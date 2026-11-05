import test from 'node:test';
import assert from 'node:assert/strict';
import {QuranProgressClient,verifyProgress} from './quranProgressClient.js';
const chapters=Array.from({length:114},()=>({ayah_count:7})),at='2026-10-19T00:00:00Z';
const row=(is_read,revision=1)=>({project_id:'synthetic',chapter:4,ayah:2,is_read,revision,read_at:is_read?at:null});
function fixture(){const rows=new Map(),requests=[],store=new Map();let lost=false,release,hold=false;
 const api={async request(path,query,body){if(!body)return {project_id:'synthetic',items:[...rows.values()]};requests.push(structuredClone(body));if(hold){hold=false;await new Promise(resolve=>release=resolve);}const previous=rows.get(body.chapter+':'+body.ayah);
  if(previous?.revision===body.expected_revision+1&&previous.is_read===body.is_read)return previous;
  if((previous?.revision||0)!==body.expected_revision)throw Object.assign(new Error('Changed progress'),{status:409,current:previous});
  const value={...row(body.is_read,body.expected_revision+1),chapter:body.chapter,ayah:body.ayah};rows.set(body.chapter+':'+body.ayah,value);if(lost){lost=false;throw new Error('Lost progress response');}return value;
 }};return {rows,requests,store,client:new QuranProgressClient(api,'synthetic',store,chapters),lose:()=>lost=true,hold:()=>hold=true,release:()=>release?.()};}
test('progress retries the original CAS after lost acknowledgement and counts each ayah once',async()=>{
 const f=fixture();await f.client.load();f.lose();await f.client.set(4,2,true);assert.equal(f.client.counts(4).total,0);assert.equal(f.store.size,1);
 await f.client.queue(4,2).retry();assert.deepEqual(f.requests[0],f.requests[1]);assert.equal(f.rows.size,1);assert.deepEqual(f.client.counts(4),{total:1,chapter:1});assert.equal(f.store.size,0);
 await f.client.set(4,2,false);assert.equal(f.client.counts(4).total,0);assert.equal(f.rows.get('4:2').read_at,null);
});
test('rapid undo during an in-flight read save keeps the newer choice and confirmed counts',async()=>{
 const f=fixture();await f.client.load();f.hold();const save=f.client.set(4,2,true);await f.client.set(4,2,false);f.release();await save;
 assert.equal(f.client.desired(4,2),false);assert.equal(f.client.counts(4).total,0);assert.equal(f.store.size,0);assert.deepEqual(f.requests.map(r=>r.expected_revision),[0,1]);
});
test('other-device changes require a choice; clean refresh permits an identical older action again',async()=>{
 const f=fixture();await f.client.load();await f.client.set(4,2,true);await f.client.set(4,2,false);
 f.rows.set('4:2',row(true,3));await f.client.load();await f.client.set(4,2,false);assert.equal(f.rows.get('4:2').revision,4);assert.equal(f.store.size,0);
 f.rows.set('4:2',row(false,5));await f.client.set(4,2,true);assert.equal(f.client.queue(4,2).status.phase,'conflict');assert.equal(f.client.desired(4,2),true);
 f.client.resolve(4,2,'saved');assert.equal(f.client.desired(4,2),false);assert.equal(f.store.size,0);
});
test('foreign projects, duplicate rows, invalid read dates and canonical bounds fail closed',async()=>{
 for(const patch of [{project_id:'foreign'},{chapter:115},{ayah:8},{is_read:'yes'},{revision:0},{read_at:null}])assert.throws(()=>verifyProgress({...row(true),...patch},'synthetic',chapters));
 const store=new Map(),api={request:async()=>({project_id:'synthetic',items:[row(true),row(true)]})},client=new QuranProgressClient(api,'synthetic',store,chapters);await client.load();assert.equal(client.loaded,false);assert.ok(client.error);assert.equal(client.counts(4).total,0);
});
