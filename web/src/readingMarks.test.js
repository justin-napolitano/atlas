import test from 'node:test';
import assert from 'node:assert/strict';
import {readingMarks,verifyReadingCapture} from './readingMarks.js';

const document={id:'document',project_id:'project',text_sha256:'immutable-hash',text_body:'😀 Before tafsīr and التفسير.'};
const note=(id,start,end,extra={})=>({id,project_id:document.project_id,document_id:document.id,text_sha256:document.text_sha256,
  start_pos:start,end_pos:end,exact:Array.from(document.text_body).slice(start,end).join(''),...extra});

test('marks preserve all original code points and keep overlapping note identities',()=>{
  const notes=[note('wide',2,15),note('term',9,15,{mark_style:'underline'}),note('arabic',20,27)];
  const value=readingMarks(document,notes,{start:9,end:15});
  assert.equal(value.runs.map(row=>row.text).join(''),document.text_body);
  assert.deepEqual(value.unanchored,[]);
  const term=value.runs.find(row=>row.text==='tafsīr');
  assert.deepEqual(term.ids,['wide','term']);assert.equal(term.underline,true);assert.equal(term.highlight,true);assert.equal(term.selected,true);
  assert.equal(value.runs.find(row=>row.ids.includes('arabic')).text,'التفسير');
});

test('stale, foreign, split or corrupted anchors never move to a matching word',()=>{
  const original=note('original',9,15);
  const invalid=[{...original,id:'hash',text_sha256:'changed'},{...original,id:'foreign',project_id:'other'},
    {...original,id:'document',document_id:'other'},{...original,id:'position',start_pos:8},
    {...original,id:'float',start_pos:9.5},{...original,id:'bounds',end_pos:500},{...original,id:'quote',exact:'different'}];
  const value=readingMarks(document,invalid);
  assert.deepEqual(value.unanchored,invalid.map(row=>row.id));
  assert.equal(value.runs.length,1);assert.deepEqual(value.runs[0].ids,[]);
});

test('empty text and invalid active selection do not create invented source characters',()=>{
  assert.deepEqual(readingMarks({...document,text_body:''},[]).runs,[]);
  assert.equal(readingMarks(document,[],{start:-1,end:4}).runs.length,1);
});

test('capture acknowledgement must preserve source, selected text and submitted body',()=>{
  const sent={annotation_uuid:'request',project_id:'project',document_id:'document',text_sha256:'hash',start:2,end:8,exact:'tafsīr',capture_kind:'comment',body:'My note',mark_style:'underline'};
  const row={...sent,id:'urn:research:annotation:request',start_pos:2,end_pos:8,revision:1};
  assert.equal(verifyReadingCapture(row,sent),row);
  for(const patch of [{project_id:'other'},{document_id:'other'},{text_sha256:'other'},{start_pos:3},{body:'Other note'},{revision:0},{mark_style:'highlight'}]) {
    assert.throws(()=>verifyReadingCapture({...row,...patch},sent),/did not match/);
  }
});
