import test from 'node:test';
import assert from 'node:assert/strict';
import { detectCommunities, layoutCommunities } from './graphLayout.js';

const nodes = ['a', 'b', 'c', 'd', 'e', 'f', 'alone'].map(id => ({ id, label: `Record ${id}` }));
const edges = [
  { from: 'a', to: 'b' }, { from: 'a', to: 'c' }, { from: 'b', to: 'c' },
  { from: 'd', to: 'e' }, { from: 'd', to: 'f' }, { from: 'e', to: 'f' },
];

test('communities follow the recorded network and retain isolated records', () => {
  const groups = detectCommunities(nodes, edges);
  assert.deepEqual(groups.map(group => group.nodes.map(node => node.id).sort()), [
    ['a', 'b', 'c'], ['d', 'e', 'f'], ['alone'],
  ]);
  assert.equal(groups[2].edges.length, 0);
});

test('community layout is stable and separates disconnected components', () => {
  const first = layoutCommunities(nodes, edges);
  const second = layoutCommunities(nodes, edges);
  assert.deepEqual([...first.positions], [...second.positions]);
  assert.equal(first.groups.length, 3);
  assert.notEqual(first.groupById.get('a'), first.groupById.get('d'));
  assert.equal(first.degree.get('a'), 2);
});
