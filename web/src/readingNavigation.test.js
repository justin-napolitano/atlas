import test from 'node:test';
import assert from 'node:assert/strict';
import {currentReadingAnchor,notebookAnchorForProject} from './readingNavigation.js';

test('a version changed in the URL keeps its own annotation tuple after leaving the reader',()=>{
  assert.deepEqual(currentReadingAnchor('p','r',{project:'p',record:'r',document:'new'}),{documentId:'new',annotationId:''});
  assert.deepEqual(currentReadingAnchor('p','r',{project:'p',record:'r',document:'new',annotation:'new-note'}),{documentId:'new',annotationId:'new-note'});
  assert.deepEqual(currentReadingAnchor('p','r',{project:'p',record:'other',document:'other'}),{documentId:'',annotationId:''});
});
test('the mounted reader wins only for the same project and source',()=>{
  const route={project:'p',record:'r',document:'url-version'},place={project_id:'p',record_id:'r',document_id:'mounted-version',annotation_id:'note'};
  assert.deepEqual(currentReadingAnchor('p','r',route,place),{documentId:'mounted-version',annotationId:'note'});
  assert.deepEqual(currentReadingAnchor('p','r',route,{...place,project_id:'other'}),{documentId:'url-version',annotationId:''});
  assert.deepEqual(currentReadingAnchor('p','r',{...route,project:'other'},null),{documentId:'',annotationId:''});
});
test('notebook creation cannot borrow another project’s prior passage',()=>{
  const anchor={project_id:'p',record_id:'r',document_id:'d',annotation_id:'a'};
  assert.equal(notebookAnchorForProject('p',anchor),anchor);
  assert.equal(notebookAnchorForProject('other',anchor),null);
  assert.equal(notebookAnchorForProject('p',{record_id:'r'}),null);
});
