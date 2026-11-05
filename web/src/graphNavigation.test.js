import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectRecord, navigateGraph, returnToGraph } from './graphNavigation.js';

const camera = { x: 25, y: -50, width: 850, height: 600 };
const initial = { history: [], current: { rootId: 'question', selectedId: 'question', mode: 'focus', camera, kind: 'all', group: 'all', started: true } };

test('inspecting a neighbor preserves the graph center, camera, filters, and navigation trail', () => {
  const inspected = inspectRecord(initial, 'source');
  assert.equal(inspected.current.rootId, 'question');
  assert.equal(inspected.current.camera, camera);
  assert.equal(inspected.history, initial.history);
  assert.equal(inspected.current.selectedId, 'source');
  assert.equal(initial.current.selectedId, 'question');
});

test('Back restores the complete previous view after explicit exploration', () => {
  const inspected = inspectRecord(initial, 'source');
  const moved = navigateGraph(inspected, { rootId: 'source', mode: 'focus' });
  assert.equal(moved.current.camera, null);
  assert.equal(moved.history.length, 1);
  assert.deepEqual(returnToGraph(moved), inspected);
});

test('breadcrumb navigation restores the chosen view and drops later trail entries', () => {
  const first = navigateGraph(initial, { rootId: 'source', selectedId: 'source' });
  const second = navigateGraph(first, { rootId: 'claim', selectedId: 'claim' });
  const back = returnToGraph(second, 0);
  assert.deepEqual(back, initial);
  assert.equal(returnToGraph(initial), initial);
  assert.equal(returnToGraph(second, 100), second);
});
