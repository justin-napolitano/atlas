import {test} from 'node:test';
import assert from 'node:assert/strict';
import {sourceRetention,itemUpdate,shelfTarget} from './libraryClient.js';
test('library save retries the same indexing UUID and exact CAS without overwriting a competing choice',async()=>{
 const calls=[],row={id:'item',revision:1,on_shelf:false,reading_status:'needs_review',preferred_edition_id:null};let attempt=0;
 const api={post:async(path,value)=>{calls.push(structuredClone(value));return {item_id:'item'};},request:async(path,query,body)=>{
  if(path==='library/item'&&!body)return row;
  if(path==='library/resolve')return {source_available:true,edition_id:'original-edition'};
  calls.push(structuredClone(body));if(!attempt++)throw new Error('Lost acknowledgement');return {...row,...body,id:'item',revision:2};
 }};
 const save=sourceRetention(api,{id:'source',project_id:'origin',revision:1},'doc');
 await assert.rejects(save);await save();assert.equal(calls[0].request_uuid,calls[2].request_uuid);assert.deepEqual(calls[1],calls[3]);assert.equal(calls[1].preferred_edition_id,'original-edition');assert.equal(calls[1].reading_status,'want_to_read');
});
test('shelf targets retain original project, edition gating and structural resume',()=>{
 assert.throws(()=>shelfTarget({availability:'choose_edition'}));
 const target=shelfTarget({availability:'read',source_available:true,preferred_edition_id:'edition',origin_project_id:'origin',record_id:'record',document_id:'document',position:24,reader:'document'});
 assert.equal(target.project_id,'origin');assert.equal(target.position,24);
 assert.equal(itemUpdate({id:'i',revision:3,on_shelf:true,reading_status:'finished',preferred_edition_id:'e'},{on_shelf:false}).reading_status,'finished');
});
