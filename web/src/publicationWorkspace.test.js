import test from 'node:test';
import assert from 'node:assert/strict';
import {PublicationWorkspace} from './publicationWorkspace.js';
import {WorkspaceError} from './workspaceClient.js';
const row=(id='source:1',project_id='project:1')=>({id,project_id,kind:'source',title:'Synthetic source',review_state:'pending',attributes:{note:'PRIVATE_RECORD_ATTRIBUTE'}});
const head=(project_id='project:1')=>({project_id,revision:0,status:'private',snapshot_id:null});
const sealed=(project='project:1')=>({id:'publication-'+'a'.repeat(32),project_id:project,payload_sha256:'b'.repeat(64),payload:{project:{id:project},nodes:[{id:'source:1',label:'Synthetic source',type:'source',summary:'',links:[]}],edges:[]}});
const setup=(post)=>{
  const calls=[];const model=new PublicationWorkspace({request:async()=>head(),post:async(path,value)=>{calls.push({path,value});return post ? post(path,value) : path==='publication/previews'?sealed():{...head(),revision:1,status:'published',snapshot_id:sealed().id};}});
  return {model,calls};
};

test('publication requires an inspected preview, literal acknowledgement and a rationale',async()=>{
  const {model,calls}=setup();await model.load('project:1');model.select('project:1',row(),true);
  await model.approve('project:1');assert.equal(calls.length,0);
  await model.makePreview('project:1');
  assert.deepEqual(calls[0].value,{project_id:'project:1',selections:[{record_id:'source:1',include_summary:false,include_bibliography:false}],relation_ids:[]});
  assert.ok(!JSON.stringify(calls).includes('PRIVATE_'));
  model.form('project:1',{rights:true});await model.approve('project:1');assert.equal(calls.length,1);
  model.form('project:1',{rationale:'Synthetic publication review'});await model.approve('project:1');
  assert.deepEqual(calls[1].value,{preview_id:sealed().id,expected_sha256:'b'.repeat(64),expected_revision:0,rationale:'Synthetic publication review',rights_checked:true});
  assert.equal(model.entry('project:1').head.status,'published');
  model.form('project:1',{rights:true,rationale:'Duplicate click'});await model.approve('project:1');assert.equal(calls.length,2);
});

test('editing selections or inclusion options discards the prior preview and acknowledgement',async()=>{
  const {model}=setup();await model.load('project:1');model.select('project:1',row(),true);await model.makePreview('project:1');
  model.form('project:1',{rights:true,rationale:'Review'});model.option('project:1','source:1','include_summary',true);
  const entry=model.entry('project:1');assert.equal(entry.preview,null);assert.equal(entry.rights,false);assert.equal(model.hasDrafts(),true);
  model.select('project:1',row('source:2'),true);assert.equal(entry.selections.size,2);
  model.select('project:1',{...row('private:1'),kind:'note'},true);assert.equal(entry.selections.size,2);
  model.select('project:1',{...row('withdrawn:1'),review_state:'withdrawn'},true);assert.equal(entry.selections.size,2);
  model.select('project:1',row('foreign:1','other-project'),true);assert.equal(entry.selections.size,2);
});

test('a lost approval response retries the exact digest and revision without refreshing first',async()=>{
  let attempts=0;
  const {model,calls}=setup(path=>{if(path==='publication/previews')return sealed();if(++attempts===1)throw new WorkspaceError(503);return {...head(),revision:1,status:'published',snapshot_id:sealed().id};});
  await model.load('project:1');model.select('project:1',row(),true);await model.makePreview('project:1');model.form('project:1',{rights:true,rationale:'Review'});
  await model.approve('project:1');assert.equal(model.entry('project:1').status,'error');await model.approve('project:1');
  assert.deepEqual(calls[1].value,calls[2].value);assert.equal(model.entry('project:1').status,'approved');
});

test('a stale approval stays blocked across unrelated requests until a new preview is made',async()=>{
  const {model,calls}=setup(path=>{if(path==='publication/previews')return sealed();if(path==='publication/relations')return {items:[],truncated:false};throw new WorkspaceError(409);});
  await model.load('project:1');model.select('project:1',row(),true);await model.makePreview('project:1');model.form('project:1',{rights:true,rationale:'Review'});
  await model.approve('project:1');const entry=model.entry('project:1');assert.equal(entry.needsPreview,true);assert.equal(entry.rights,false);
  await model.findRelations('project:1');await model.load('project:1');model.form('project:1',{rights:true});await model.approve('project:1');
  assert.equal(calls.filter(c=>c.path==='publication/approve').length,1);
  await model.makePreview('project:1');assert.equal(entry.needsPreview,false);assert.equal(entry.rights,false);
});

test('relations are explicit and removing a record clears now-invalid connection choices',async()=>{
  const edge={id:'edge:1',from_id:'source:1',to_id:'source:2'};
  const {model,calls}=setup(path=>path==='publication/relations'?{items:[edge],truncated:true}:sealed());
  await model.load('project:1');model.select('project:1',row(),true);model.select('project:1',row('source:2'),true);
  await model.findRelations('project:1');const entry=model.entry('project:1');assert.equal(entry.relationIds.size,0);assert.equal(entry.relationsTruncated,true);
  model.relation('project:1','unknown-edge',true);assert.equal(entry.relationIds.size,0);
  model.relation('project:1','edge:1',true);await model.makePreview('project:1');assert.deepEqual(calls.at(-1).value.relation_ids,['edge:1']);
  model.select('project:1',row('source:2'),false);assert.equal(entry.relationIds.size,0);assert.equal(entry.preview,null);
});

test('withdrawal needs explicit confirmation and a failed response requires a head refresh',async()=>{
  const {model,calls}=setup(()=>{throw new WorkspaceError(409);});const entry=model.entry('project:1');entry.head={...head(),revision:3,status:'published',snapshot_id:'old-publication'};
  model.select('project:1',row(),true);model.form('project:1',{withdrawReason:'Correction'});await model.withdraw('project:1');assert.equal(calls.length,0);
  model.form('project:1',{withdrawConfirmed:true});await model.withdraw('project:1');assert.equal(entry.needsHead,true);assert.equal(entry.withdrawConfirmed,false);
  model.form('project:1',{withdrawConfirmed:true});await model.withdraw('project:1');assert.equal(calls.length,1);
  await model.load('project:1');assert.equal(entry.needsHead,false);assert.equal(entry.selections.size,1);assert.equal(entry.dirty,true);
});

test('late project responses stay in their own session and sealed previews reopen without approval',async()=>{
  let resolve;const pending=new Promise(r=>{resolve=r;});let writes=0;
  const model=new PublicationWorkspace({request:async(path,params)=>path==='publication/preview'?sealed(params.project_id):params.project_id==='project:1'?pending:head(params.project_id),post:()=>{writes++;}});
  const first=model.load('project:1');await model.load('project:2',sealed().id);resolve(head());await first;
  assert.equal(model.entry('project:1').head.project_id,'project:1');assert.equal(model.entry('project:2').preview.project_id,'project:2');
  assert.equal(model.entry('project:2').rights,false);assert.equal(writes,0);
  model.select('project:1',row(),true);assert.equal(model.entry('project:2').selections.size,1);
});
