import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregateLinks, buildGraphView, edgeGeometry, wrapLabel } from './graphGeometry.js';

const record = id => ({ id, label: `Record ${id}`, type: 'claim' });

test('focused view shows only real incident links and retains an isolated selected record', () => {
  const nodes = ['a', 'b', 'c', 'alone'].map(record);
  const edges = [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }, { from: 'missing', to: 'a' }];
  const focus = buildGraphView(nodes, edges, 'a');
  assert.deepEqual(focus.nodes.map(n => n.id), ['a', 'b']);
  assert.deepEqual(focus.edges, [edges[0]]);
  const isolated = buildGraphView(nodes, edges, 'alone');
  assert.deepEqual(isolated.nodes.map(n => n.id), ['alone']);
  assert.equal(isolated.edges.length, 0);
  assert.equal(buildGraphView([], edges, 'a').root, null);
});

test('label cards remain disjoint in focused neighborhoods of 1–20 neighbors', () => {
  for (let count = 1; count <= 20; count++) {
    const nodes = Array.from({ length: count + 1 }, (_, i) => record(String(i)));
    const edges = nodes.slice(1).map(n => ({ from: '0', to: n.id }));
    const points = [...buildGraphView(nodes, edges, '0').positions.values()];
    for (let i = 0; i < points.length; i++) for (let j = i + 1; j < points.length; j++) {
      const a = points[i], b = points[j];
      assert.ok(Math.abs(a.x-b.x) >= (a.width+b.width)/2 + 16 || Math.abs(a.y-b.y) >= (a.height+b.height)/2 + 16, `overlap for ${count} neighbors`);
    }
  }
});

test('network layout is stable under input reorder and every card stays inside its group', () => {
  const nodes = ['a', 'b', 'c', 'd', 'e', 'alone'].map(record);
  const edges = [{from:'a',to:'b'}, {from:'b',to:'c'}, {from:'d',to:'e'}];
  const first = buildGraphView(nodes, edges, 'a', 'network');
  const second = buildGraphView([...nodes].reverse(), [...edges].reverse(), 'a', 'network');
  assert.deepEqual([...first.positions], [...second.positions]);
  for (const g of first.groups) for (const id of g.nodeIds) {
    const p = first.positions.get(id);
    assert.ok(p.x - p.width/2 >= g.x && p.x + p.width/2 <= g.x + g.width);
    assert.ok(p.y - p.height/2 >= g.y && p.y + p.height/2 <= g.y + g.height);
  }
});

test('grouped links preserve recorded counts and direction without inventing internal links', () => {
  const groups = [{id:'left',nodeIds:['a','b']},{id:'right',nodeIds:['c']}];
  const edges = [{from:'a',to:'b'}, {from:'a',to:'c'}, {from:'b',to:'c'}, {from:'c',to:'a'}];
  assert.deepEqual(aggregateLinks(groups,edges), [{from:'left',to:'right',count:2},{from:'right',to:'left',count:1}]);
});

test('directional connectors end outside card bodies and self-links are finite', () => {
  const a = {x:0,y:0,width:224,height:104}, b = {...a,x:430};
  const forward = edgeGeometry(a,b);
  const startX = Number(forward.path.split(' ')[1]);
  const endX = Number(forward.path.split(' ').at(-2));
  assert.ok(startX > a.width/2 && startX < b.x-b.width/2);
  assert.ok(endX < b.x-b.width/2 && endX > a.width/2);
  assert.ok(!edgeGeometry(a,a).path.includes('NaN'));
  assert.equal(wrapLabel('a long title with several words to read', 15, 2).length, 2);
  assert.ok(wrapLabel('a long title with several words to read', 15, 2)[1].endsWith('…'));
});
