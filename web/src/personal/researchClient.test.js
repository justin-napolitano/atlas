import test from 'node:test';import assert from 'node:assert/strict';import {ResearchSession,newRecord} from './researchClient.js';
test('uncertain research retries retain the same exact operation despite new caller fields',async()=>{
 const calls=[];let lose=true;const client={brain:()=>'/scope',request:async(path,body)=>{if(!body)return {generation_id:'synthetic-generation',items:[],total:0};calls.push(structuredClone(body));if(lose){lose=false;throw Error('lost');}return {operation_id:body.operation_id,generation_id:body.generation_id,outcome:'accepted',record:{...body.record,revision:1}};}};
 const store=new ResearchSession(client,'alice','brain');await store.load();const original=newRecord('collection',{title:'Original'});await assert.rejects(store.save(original));await store.save(newRecord('collection',{title:'Changed'}));assert.deepEqual(calls[0],calls[1]);assert.equal(store.pending,null);
});

test('accepted operation consumes its scoped cached form even when refresh fails',async()=>{
 const {consumeResearchForm}=await import('./researchClient.js');
 let accepted=false,completed=0;
 const client={brain:()=>'/scope',request:async(path,body)=>{if(body){accepted=true;return {operation_id:body.operation_id,generation_id:body.generation_id,outcome:'accepted',record:{...body.record,revision:1}};}if(accepted)throw Error('refresh offline');return {generation_id:'g',items:[],total:0};}};
 const form={title:'Synthetic source',text:'Exact 😀\r\nwriting'},otherScope={...form},store=new ResearchSession(client,'a','b');await store.load();
 store.onAccepted=(_,record)=>{completed++;consumeResearchForm(form,record);};
 const record=newRecord('source',{title:form.title,document:form.text});
 const receipt=await store.save(record);
 assert.equal(receipt.outcome,'accepted');assert.equal(store.pending,null);assert.equal(store.uncertain,false);assert.match(store.refreshError.message,/offline/);assert.equal(store.snapshot.items[0].document,record.document);
 assert.equal(completed,1);assert.equal(form.text,'');assert.equal(form.sourceID,record.id);assert.equal(otherScope.text,record.document);
});

test('SQLite-restored pending is uncertain and retains exact operation after a later validation rejection',async()=>{
 const op={operation_id:'original',generation_id:'g',base_revision:0,record:newRecord('annotation',{body:'Exact retained writing'})},calls=[];
 const store=new ResearchSession({brain:()=>'/scope',request:async(path,body)=>{if(!body)return {generation_id:'g',items:[],total:0,pending:[{operation:op}]};calls.push(body);throw Object.assign(Error('rejected'),{status:422});}},'a','b');
 await store.load();assert.equal(store.uncertain,true);await assert.rejects(store.save(newRecord('collection',{title:'Different'})));
 assert.deepEqual(store.pending,op);assert.deepEqual(calls[0],op);
});

test('confirmed completion resets uncertainty so a fresh known rejection remains editable',async()=>{
 let attempt=0;const client={brain:()=>'/scope',request:async(path,body)=>{if(!body)return {generation_id:'g',items:[],total:0};attempt++;if(attempt===1)throw Error('lost');if(attempt===3)throw Object.assign(Error('invalid'),{status:422});return {operation_id:body.operation_id,generation_id:body.generation_id,outcome:'accepted',record:{...body.record,revision:1}};}};
 const store=new ResearchSession(client,'a','b');await store.load();const record=newRecord('collection',{title:'Original'});
 await assert.rejects(store.save(record));await store.save(record);assert.equal(store.uncertain,false);
 await assert.rejects(store.save(newRecord('collection',{title:'Editable rejection'})));assert.equal(store.pending,null);assert.equal(store.uncertain,false);
});

test('wrong acknowledged body never confirms a research operation',async()=>{
 const store=new ResearchSession({brain:()=>'/scope',request:async(path,body)=>body?{operation_id:body.operation_id,generation_id:body.generation_id,outcome:'accepted',record:{...body.record,revision:1,body:'Different'}}:{generation_id:'g',items:[],total:0}},'a','b');
 await store.load();await assert.rejects(store.save(newRecord('annotation',{body:'Exact'})),/not confirmed/);assert.equal(store.pending.record.body,'Exact');
});

test('passage drafts freeze exact Unicode selector and source context; private sharing is the default',async()=>{
 const {bindPassage,passageRecord,consumeResearchForm}=await import('./researchClient.js');
 const source={id:'source-a',document_version:'v1',sha256:'hash-a',document:'😀 Exact العربية text'},selection={start:2,end:7,exact:'Exact'};
 const draft=bindPassage(source,selection);source.id='source-b';source.sha256='hash-b';
 const record=passageRecord(draft,'My exact note');assert.equal(record.source_id,'source-a');assert.equal(record.sha256,'hash-a');assert.equal(record.selector.prefix,'😀 ');assert.equal(record.visibility,'private');assert.equal(passageRecord(draft,'My exact note',true).visibility,'shared');
 const form={draft,body:'My exact note',shared:false};consumeResearchForm(form,record);assert.equal(form.draft,null);assert.equal(form.body,'');
 const newer={draft,body:'Newer writing',shared:false};consumeResearchForm(newer,record);assert.equal(newer.body,'Newer writing');assert.equal(newer.draft,draft);
 assert.throws(()=>bindPassage({...source,document:'Other'},{...selection}),/did not match/);
});

test('confirmed conflict resolution is explicit, exact, retryable and preserves the original proposal',async()=>{
 let failResolve=true;const calls=[];
 const client={brain:()=>'/scope',request:async(path,body)=>{
  if(!body)return {generation_id:'g',items:[],total:0};calls.push({path,body});
  if(path.endsWith('/resolve')){if(failResolve){failResolve=false;throw Error('resolution response lost');}return {operation_id:body.operation_id,resolved:true};}
  return {operation_id:body.operation_id,generation_id:body.generation_id,outcome:'conflict',record:{...body.record,title:'Current',revision:2}};
 }};
 const store=new ResearchSession(client,'a','b');await store.load();await assert.rejects(store.resolveConflict(),/Only a confirmed/);
 await assert.rejects(store.save(newRecord('collection',{title:'Original'})));const original=structuredClone(store.pending);
 await assert.rejects(store.resolveConflict(),/lost/);assert.deepEqual(store.pending,original);
 await store.resolveConflict();assert.equal(store.pending,null);assert.deepEqual(store.resolvedProposals[0].operation,original);assert.deepEqual(calls[1],calls[2]);
});

test('offline cached research restores exact pending retry but blocks new mutations until a fresh load',async()=>{
 const op={operation_id:'retained',generation_id:'g',base_revision:0,record:newRecord('collection',{title:'Exact original'})};
 let offline=true,hasPending=true;const calls=[];
 const client={brain:()=>'/scope',request:async(path,body)=>{
  if(!body)return {generation_id:'g',items:[],total:0,offline,pending:hasPending?[{operation:op}]:[]};
  calls.push(body);hasPending=false;return {operation_id:body.operation_id,generation_id:body.generation_id,outcome:'accepted',record:{...body.record,revision:1}};
 }};
 const store=new ResearchSession(client,'a','b');await store.load();assert.equal(store.snapshot.offline,true);assert.equal(store.uncertain,true);
 await store.save(newRecord('collection',{title:'Different'}));assert.deepEqual(calls[0],op);
 const draft=newRecord('collection',{title:'Retained new draft'});await assert.rejects(store.save(draft),/Load current research/);assert.equal(store.pending,null);assert.equal(calls.length,1);assert.equal(draft.title,'Retained new draft');
 offline=false;await store.load();await store.save(draft);assert.equal(calls.length,2);
});

test('page-lifetime unload guard covers inactive scope drafts and stops warning when all scopes are clean',async()=>{
 const {hasRetainedResearchDraft,consumeResearchForm}=await import('./researchClient.js');
 const inactive={store:{dirty:false},form:{groupTitle:'Unsent group'}},active={store:{dirty:false},form:{sourceID:'selected-source',shared:true,group:'selected-group'}};
 const scopes=new Map([['inactive',inactive],['active',active]]);
 assert.equal(hasRetainedResearchDraft(scopes.values()),true);
 consumeResearchForm(inactive.form,newRecord('collection',{title:'Unsent group'}));assert.equal(hasRetainedResearchDraft(scopes.values()),false);
 inactive.store.dirty=true;assert.equal(hasRetainedResearchDraft(scopes.values()),true);inactive.store.dirty=false;
 inactive.form.draft={selector:{exact:'Selected source passage'}};assert.equal(hasRetainedResearchDraft(scopes.values()),true);inactive.form.draft=null;
 assert.equal(hasRetainedResearchDraft(scopes.values()),false);
});
