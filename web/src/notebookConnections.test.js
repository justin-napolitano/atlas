import test from 'node:test';
import assert from 'node:assert/strict';
import {notebookConnection} from './notebookConnections.js';

test('notebook links preserve typed identities and attach document results to the source record',()=>{
  assert.deepEqual(notebookConnection({kind:'thought',entry_id:'note:1',record_id:'source:old'}),{kind:'entry',id:'note:1'});
  assert.deepEqual(notebookConnection({kind:'concept',concept_id:'concept:1',record_id:'source:old',annotation_id:'passage:old'}),{kind:'record',id:'concept:1'});
  assert.deepEqual(notebookConnection({kind:'definition',annotation_id:'passage:1',record_id:'source:1'}),{kind:'annotation',id:'passage:1'});
  assert.deepEqual(notebookConnection({kind:'document',id:'edition:1',record_id:'source:1'}),{kind:'record',id:'source:1'});
  assert.equal(notebookConnection({kind:'document',id:'edition:orphan'}),null);
});
