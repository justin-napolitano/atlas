import test from 'node:test';
import assert from 'node:assert/strict';
import {warmKeys,workStatus} from './workingCache.js';
test('thirty clean pages retain only the active and three most recent surfaces',()=>{
  const keys=Array.from({length:30},(_,n)=>String(n));
  assert.deepEqual([...warmKeys(keys,'0',new Set())],['0','29','28','27']);
  assert.equal(warmKeys(keys,'29',new Set()).size,4);
});
test('dirty, conflicted and pending pages exceed the limit safely until saved',()=>{
  const protectedKeys=new Set(['a','b','c','d','e']);
  assert.deepEqual([...warmKeys(['a','b','c','d','e','f'],'f',protectedKeys)],['a','b','c','d','e','f']);
  assert.equal(warmKeys(['a','b','c','d','e','f'],'f',new Set()).size,4);
});
test('tab status tracks the actual project and confirmed note state',()=>{
  const item={project:'one',snapshot:{selected:'source',selectedDocument:'document',libraryView:''}},records=new Map(),passages=new Map(),drafts=new Map();
  records.set('source',{server:{project_id:'one'},status:'saving',pending:Promise.resolve()});
  assert.equal(workStatus(item,{records,passages,drafts}),'Saving');
  records.get('source').status='saved';records.get('source').pending=null;
  drafts.set('capture:document',{body:'Unfinished'});assert.equal(workStatus(item,{records,passages,drafts}),'Unsaved');
  drafts.clear();assert.equal(workStatus(item,{records,passages,drafts}),'');
  drafts.set('notebook:'+JSON.stringify(['other','new']),{value:{body:'Foreign'}});
  assert.equal(workStatus({...item,snapshot:{libraryView:'notebook'}},{records,passages,drafts}),'');
  drafts.set('notebook:'+JSON.stringify(['one','new']),{saving:false,current:{revision:2}});
  assert.equal(workStatus({...item,snapshot:{libraryView:'notebook'}},{records,passages,drafts}),'Conflict');
});
test('free margin writing protects the reading tab for its own source and project',()=>{
  const item={project:'one',snapshot:{selected:'source',selectedDocument:'edition',libraryView:''}};
  const drafts=new Map([['notebook:'+JSON.stringify(['one','note']),{workspaceMode:'location-margin',sourceRecordId:'source',projectId:'one',documentId:'edition',saving:true}]]);
  const values={drafts,records:new Map(),passages:new Map()};
  assert.equal(workStatus(item,values),'Saving');
  assert.equal(workStatus({...item,project:'other'},values),'');
  assert.equal(workStatus({...item,snapshot:{...item.snapshot,selected:'other'}},values),'');
});
