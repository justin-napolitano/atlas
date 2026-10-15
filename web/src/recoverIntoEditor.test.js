import test from 'node:test';
import assert from 'node:assert/strict';
import {ReadingWorkspace,blankState} from './workspaceClient.js';
import {PassageNoteEditor} from './passageNoteEditor.js';
import {recoverRecordWriting,recoverPassageWriting} from './recoverIntoEditor.js';

test('record recovery adopts current progress/CAS baseline and leaves note uncommitted',()=>{
  let writes=0;const store=new ReadingWorkspace({save:()=>writes++});const record={id:'s',project_id:'p'};store.adopt(blankState('s','p'));
  const recovered={record_id:'s',project_id:'p',context_kind:'record_note',body:'Recovered thought',current_snapshot:{record_id:'s',project_id:'p',revision:4,note:'Cloud thought',reading:'read',decision:'relevant'}};
  assert.equal(recoverRecordWriting(store,record,recovered),true);const value=store.entries.get('s');
  assert.equal(value.server.revision,4);assert.equal(value.draft.reading,'read');assert.equal(value.draft.note,'Recovered thought');assert.equal(value.server.note,'Cloud thought');assert.equal(writes,0);
  value.pending=Promise.resolve();assert.equal(recoverRecordWriting(store,record,{...recovered,body:'Overwrite pending'}),false);assert.equal(value.draft.note,'Recovered thought');
});
test('passage recovery refuses different immutable selectors and preserves latest note baseline',()=>{
  let writes=0;const editor=new PassageNoteEditor({request:()=>writes++}),record={id:'s',project_id:'p'};
  const current={id:'a',project_id:'p',document_id:'d',text_sha256:'x',start_pos:2,end_pos:8,exact:'tafsīr',body:'Cloud note',mark_style:'highlight',revision:3};
  const recovered={record_id:'s',project_id:'p',context_kind:'annotation',annotation_id:'a',document_id:'d',text_sha256:'x',start:2,end:8,exact:'tafsīr',body:'Unfinished interpretation',mark_style:'underline',current_snapshot:current};
  assert.equal(recoverPassageWriting(editor,record,{...recovered,end:9}),false);assert.equal(recoverPassageWriting(editor,record,recovered),true);
  assert.equal(editor.entries.get('a').server.revision,3);assert.equal(editor.entries.get('a').body,'Unfinished interpretation');assert.equal(editor.entries.get('a').status,'unsaved');assert.equal(writes,0);
});
