import test from 'node:test';
import assert from 'node:assert/strict';
import { layoutNetwork, networkView, placeNetworkLabels } from './networkLayout.js';
const nodes=['a','b','c','d','alone'].map(id=>({id,label:`Record ${id}`}));
const edges=[{from:'a',to:'b'},{from:'b',to:'c'},{from:'c',to:'d'}];
test('network layout is deterministic, finite, and does not mutate canonical data',()=>{
  const snapshot=JSON.stringify({nodes,edges});
  const first=layoutNetwork(nodes,edges),second=layoutNetwork([...nodes].reverse(),[...edges].reverse());
  for(const [id,p] of first.positions){assert.ok(Number.isFinite(p.x)&&Number.isFinite(p.y));assert.deepEqual(p,second.positions.get(id));}
  assert.equal(JSON.stringify({nodes,edges}),snapshot);
});
test('local depth preserves global coordinates and dragging pins only the moved point',()=>{
  const layout=layoutNetwork(nodes,edges);
  const local=networkView(nodes,edges,layout,'a','focus',1);
  assert.deepEqual(local.nodes.map(n=>n.id),['a','b']);
  assert.deepEqual(local.positions.get('a'),layout.positions.get('a'));
  const deeper=networkView(nodes,edges,layout,'a','focus',2,{b:{x:20,y:30}});
  assert.deepEqual(deeper.nodes.map(n=>n.id),['a','b','c']);
  assert.equal(deeper.positions.get('b').x,20);
  assert.equal(deeper.positions.get('c').x,layout.positions.get('c').x);
});
test('labels retain every record and finite geometry at different overview scales',()=>{
  const layout=layoutNetwork(nodes,edges);
  for(const scale of [.4,1,2]){
    const labels=placeNetworkLabels(nodes,layout.positions,scale);
    assert.equal(labels.size,nodes.length);
    assert.ok([...labels.values()].every(l=>Number.isFinite(l.x)&&Number.isFinite(l.y)&&l.text));
  }
});
