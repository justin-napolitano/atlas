import test from 'node:test';
import assert from 'node:assert/strict';
import {ConnectedWriting,captureTitle} from './connectedWriting.js';
const settle=()=>new Promise(resolve=>setTimeout(resolve,0));
function fake(){
 let current=null;const calls=[],drafts=new Map();let hold=null,lost=false;
 const api={request:async(path,params,value)=>{
  if(path==='workspace/draft'){const row={...structuredClone(value),id:'urn:research:writing-draft:'+value.draft_uuid,revision:value.expected_revision+1};drafts.set(row.id,row);return row;}
  if(path==='workspace/note'){calls.push(structuredClone(value));current={...current,...structuredClone(value),revision:value.expected_revision+1,title_mode:value.title?'manual':'automatic',title:value.title||captureTitle(value.body)};return current;}
 },post:async(path,value)=>{calls.push(structuredClone(value));if(!current)current={...structuredClone(value),id:'urn:research:notebook:'+value.request_uuid,revision:1,title_mode:value.title?'manual':'automatic',title:value.title||captureTitle(value.body),state:'active'};if(hold)await hold;if(lost){lost=false;throw new Error('Lost acknowledgement');}return structuredClone(current);}};
 return {api,calls,drafts,setHold:value=>{hold=value;},lose:()=>{lost=true;}};
}
test('typing during held create remains newer, next write uses original note identity',async()=>{
 const f=fake();let release;f.setHold(new Promise(resolve=>release=resolve));const note=new ConnectedWriting(f.api,{delay:100000});
 note.edit({body:'First idea'});const saving=note.flush();await settle();note.edit({body:'First idea plus newer typing'});release();await saving;await settle();await note.flush();
 assert.equal(note.value.body,'First idea plus newer typing');assert.equal(note.row.body,note.value.body);assert.equal(note.row.revision,2);assert.equal(f.calls[1].entry_id,note.id);assert.equal(note.saved,true);
});
test('lost response retries frozen UUID and payload without losing newer writing',async()=>{
 const f=fake(),note=new ConnectedWriting(f.api,{delay:100000});f.lose();note.edit({body:'Original frozen idea'});await note.flush();assert.equal(note.queue.status.phase,'error');note.edit({body:'More writing'});await note.retry();await settle();await note.flush();assert.equal(f.calls[0].request_uuid,f.calls[1].request_uuid);assert.equal(f.calls[0].body,f.calls[1].body);assert.equal(note.row.body,'More writing');
});
test('independent captures and blank editing retain their own recovery',async()=>{
 const f=fake(),one=new ConnectedWriting(f.api,{delay:100000}),two=new ConnectedWriting(f.api,{delay:100000});assert.notEqual(one.id,two.id);
 one.edit({body:'## An idea العربية 😀'});await one.flush();one.edit({body:''});await one.flush();assert.equal(one.saved,false);assert.equal(one.row.body,'## An idea العربية 😀');assert.equal(one.value.body,'');assert.equal(one.queue.status.phase,'paused');
});
test('manual names survive editing the first line',async()=>{
 const f=fake(),note=new ConnectedWriting(f.api,{delay:100000});note.edit({title:'Chosen name',body:'Opening'});await note.flush();note.edit({body:'Different opening'});await note.flush();assert.equal(note.row.title,'Chosen name');
});
