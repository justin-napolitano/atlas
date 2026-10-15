import test from 'node:test';
import assert from 'node:assert/strict';
import { PassageNoteEditor } from './passageNoteEditor.js';
import { WorkspaceError } from './workspaceClient.js';

const row=()=>({id:'annotation:1',project_id:'project:1',document_id:'document:1',body:'Original note',revision:1,exact:'tafsīr'});
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));

test('edits survive navigation and saved response keeps the exact target',async()=>{
  const calls=[];
  const editor=new PassageNoteEditor({request:async(path,params,value)=>{calls.push({path,params,value});return {...row(),body:value.body,revision:2};}});
  editor.adopt(row(),'source:1');editor.open('annotation:1');editor.edit('annotation:1','My new note');
  assert.equal(editor.documentForSource('project:1','source:1'),'document:1');
  assert.equal(editor.documentForSource('another-project','source:1'),undefined);
  assert.equal(editor.adopt(row(),'source:1').body,'My new note');
  await editor.save('annotation:1');
  assert.deepEqual(calls,[{path:'reading/annotation',params:{},value:{annotation_id:'annotation:1',project_id:'project:1',body:'My new note',expected_revision:1}}]);
  assert.equal(editor.hasDrafts(),false);
  assert.equal(editor.adopt(row(),'source:1').server.revision,2); // Stale list response cannot roll back a save.
  assert.equal(editor.adopt(row(),'source:1').server.exact,'tafsīr');
  await editor.save('annotation:1');assert.equal(calls.length,1);
});

test('typing during a pending save remains an unsaved draft without parallel writes',async()=>{
  const pending=deferred();let writes=0;
  const editor=new PassageNoteEditor({request:()=>{writes++;return pending.promise;}});
  const entry=editor.adopt(row(),'source:1');editor.edit('annotation:1','First draft');
  const saved=editor.save('annotation:1');await tick();
  editor.edit('annotation:1','Typed while saving');editor.save('annotation:1');editor.close('annotation:1');
  assert.equal(writes,1);pending.resolve({...row(),body:'First draft',revision:2});await saved;
  assert.equal(entry.server.body,'First draft');assert.equal(entry.body,'Typed while saving');
  assert.equal(entry.status,'unsaved');assert.equal(editor.hasDrafts(),true);
});

test('cloud conflict requires a choice and a second conflict is compared again',async()=>{
  const calls=[];let cloud={...row(),body:'Cloud version',revision:5};
  const editor=new PassageNoteEditor({request:async(path,params,value)=>{calls.push(value);throw new WorkspaceError(409,cloud);}});
  const entry=editor.adopt(row(),'source:1');editor.edit('annotation:1','My draft');await editor.save('annotation:1');
  assert.equal(entry.body,'My draft');assert.equal(entry.current.body,'Cloud version');
  await editor.save('annotation:1');assert.equal(calls.length,1);
  cloud={...cloud,body:'Cloud changed again',revision:6};editor.resolve('annotation:1','draft');await entry.pending;
  assert.equal(calls[1].expected_revision,5);assert.equal(entry.current.revision,6);assert.equal(entry.body,'My draft');
  editor.resolve('annotation:1','cloud');assert.equal(entry.body,'Cloud changed again');assert.equal(editor.hasDrafts(),false);
});

test('network failure retains a draft; retry recognizes a lost successful response',async()=>{
  let writes=0;
  const editor=new PassageNoteEditor({request:async()=>{if(++writes===1) throw new WorkspaceError(503);throw new WorkspaceError(409,{...row(),body:'Saved despite lost response',revision:2});}});
  const entry=editor.adopt(row(),'source:1');editor.edit('annotation:1','Saved despite lost response');
  await editor.save('annotation:1');assert.equal(entry.status,'error');assert.equal(editor.hasDrafts(),true);
  await editor.save('annotation:1');assert.equal(entry.status,'saved');assert.equal(entry.server.revision,2);
});

test('mismatched conflict and success responses cannot adopt another annotation',async()=>{
  for(const conflict of [false,true]) {
    const editor=new PassageNoteEditor({request:async()=>{const unrelated={...row(),id:'another-annotation',body:'Other private note',revision:9};if(conflict) throw new WorkspaceError(409,unrelated);return unrelated;}});
    const entry=editor.adopt(row(),'source:1');editor.edit('annotation:1','My draft');await editor.save('annotation:1');
    assert.equal(entry.status,'error');assert.equal(entry.body,'My draft');assert.equal(entry.server.id,'annotation:1');assert.equal(entry.current,null);
  }
});

test('reverting text after a lost response still requires confirming the cloud state',async()=>{
  let writes=0;
  const editor=new PassageNoteEditor({request:async()=>{if(++writes===1) throw new WorkspaceError(503);throw new WorkspaceError(409,{...row(),body:'Possibly committed edit',revision:2});}});
  const entry=editor.adopt(row(),'source:1');editor.edit('annotation:1','Possibly committed edit');
  await editor.save('annotation:1');editor.edit('annotation:1',row().body);
  assert.equal(entry.status,'error');assert.equal(editor.hasDrafts(),true);
  await editor.save('annotation:1');assert.equal(entry.status,'conflict');assert.equal(entry.body,row().body);
  assert.equal(entry.current.body,'Possibly committed edit');
});

test('refresh adopts a newer saved note, but preserves an unsaved local edit',()=>{
  const editor=new PassageNoteEditor({});const entry=editor.adopt(row(),'source:1');
  editor.adopt({...row(),body:'New cloud note',revision:2},'source:1');assert.equal(entry.body,'New cloud note');
  editor.edit('annotation:1','Unsaved local note');editor.adopt({...row(),body:'Newer cloud note',revision:3},'source:1');
  assert.equal(entry.body,'Unsaved local note');assert.equal(entry.server.revision,2);
  editor.close('annotation:1');assert.equal(entry.body,'New cloud note');assert.equal(editor.hasDrafts(),false);
  assert.throws(()=>editor.adopt({...row(),document_id:'different-document'},'source:1'),/identity/);
});
