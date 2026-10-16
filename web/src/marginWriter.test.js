import test from 'node:test';
import assert from 'node:assert/strict';
import {marginWriter} from './marginWriter.js';
import {notebookMetadata} from './notebookClient.js';
import {boundedPosition} from './readingPosition.js';
const projectId='synthetic:project',uuid='f626c0e5-3d84-45c4-91c6-2bd4ffb87afa',id='urn:research:notebook:'+uuid;
const initial={id,record_id:'source',document_id:'edition:one',annotation_id:null,reading_position:2,thought_type:'note',title:'Margin note',body:'😀 التفسير **tafsīr**',links:[],state:'active'};
const error=()=>Object.assign(new Error('Lost acknowledgement'),{status:503});
function fixture(){let row;const requests=[];let loseCreate=false,loseEdit=false,hold=null;
  const api={async post(path,sent){requests.push(structuredClone(sent));assert.equal('state' in sent,false);row ||= {...sent,id,revision:1,state:'active'};if(loseCreate){loseCreate=false;throw error();}return {id,project_id:projectId};},
    async request(path,params,sent){if(!sent)return structuredClone(row);requests.push(structuredClone(sent));if(hold)await hold;
      if(row.revision!==sent.expected_revision){if(row.revision===sent.expected_revision+1&&row.body===sent.body)return structuredClone(row);throw {status:409,current:structuredClone(row)};}
      row={...row,...sent,revision:row.revision+1};if(loseEdit){loseEdit=false;throw error();}return structuredClone(row);}};
  return {api,requests,get row(){return row;},loseCreation(){loseCreate=true;},loseCorrection(){loseEdit=true;},hold(){hold=new Promise(resolve=>this.release=()=>{hold=null;resolve();});},remote(){row={...row,revision:row.revision+1,body:'Other device'};}};
}
test('automatic margin creation and correction retry frozen identity/CAS without duplicate notes',async()=>{
  const f=fixture(),q=marginWriter({api:f.api,projectId,id,initial});
  f.loseCreation();q.enqueue(notebookMetadata(initial));await q.flush();assert.equal(q.status.phase,'error');
  q.enqueue({...notebookMetadata(initial),body:'Newer thought'});await q.retry();
  assert.equal(q.status.phase,'saved');assert.equal(q.row.body,'Newer thought');assert.equal(q.row.revision,2);
  assert.deepEqual(f.requests[0],f.requests[1]);assert.equal(f.requests[0].request_uuid,uuid);assert.equal(f.requests[0].reading_position,2);
  f.loseCorrection();q.enqueue({...notebookMetadata(initial),body:'Third thought'});await q.flush();assert.equal(q.status.phase,'error');
  await q.retry();assert.equal(q.row.revision,3);assert.deepEqual(f.requests.at(-1),f.requests.at(-2));
});
test('typing during a pending margin save is serialized against its acknowledged revision',async()=>{
  const f=fixture(),q=marginWriter({api:f.api,projectId,id,initial});q.enqueue(notebookMetadata(initial));await q.flush();
  f.hold();q.enqueue({...notebookMetadata(initial),body:'Older'});const saving=q.flush();
  q.enqueue({...notebookMetadata(initial),body:'Newer'});f.release();await saving;
  assert.equal(q.row.body,'Newer');assert.equal(q.row.revision,3);assert.equal(f.requests.at(-1).expected_revision,2);
});
test('another device retains both versions and response relocation is never accepted',async()=>{
  const f=fixture(),q=marginWriter({api:f.api,projectId,id,initial});q.enqueue(notebookMetadata(initial));await q.flush();f.remote();
  q.enqueue({...notebookMetadata(initial),body:'My local version'});await q.flush();assert.equal(q.status.phase,'conflict');assert.equal(q.status.current.body,'Other device');assert.equal(q.latest.body,'My local version');
  const bad=marginWriter({api:{post:async()=>({id,project_id:projectId}),request:async()=>({...initial,id,project_id:projectId,revision:1,reading_position:3})},projectId,id,initial});
  bad.enqueue(notebookMetadata(initial));await bad.flush();assert.equal(bad.status.phase,'error');assert.equal(bad.row,null);
});
test('reading points count Unicode characters and reject fractional, missing or out-of-range positions',()=>{
  for(const point of [0,1,2,3])assert.equal(boundedPosition('😀عx',point),point);
  for(const point of [-1,4,null,1.5,'1'])assert.equal(boundedPosition('😀عx',point),null);
});
test('leaving an already saved editor does not write a redundant revision',async()=>{
  const f=fixture(),q=marginWriter({api:f.api,projectId,id,initial});q.enqueue(notebookMetadata(initial));await q.flush();await q.flush();await q.flush();
  assert.equal(f.requests.length,1);assert.equal(q.row.revision,1);
});
