import test from 'node:test';
import assert from 'node:assert/strict';
import { adjacencyFor, graphMetrics, neighborhood, pathSegments, shortestPath } from './graphAlgorithms.js';
const nodes=['a','b','c','d','alone'].map(id=>({id,label:id}));
const edges=[{from:'a',to:'b',label:'source'},{from:'a',to:'b',label:'evidence'},{from:'b',to:'c',label:'related'},{from:'c',to:'d',label:'about'},{from:'a',to:'a',label:'self'},{from:'a',to:'missing'}];

test('depth walks recorded connections without including unknown nodes or counting parallel predicates twice',()=>{
  assert.deepEqual(adjacencyFor(nodes,edges).get('a'),['b']);
  assert.deepEqual([...neighborhood(nodes,edges,'b',1)],[['b',0],['a',1],['c',1]]);
  assert.equal(neighborhood(nodes,edges,'b',2).get('d'),2);
  assert.deepEqual([...neighborhood(nodes,edges,'alone',3)],[['alone',0]]);
});
test('shortest paths honor direction, reverse traversal, disconnected records, and identity',()=>{
  assert.deepEqual(shortestPath(nodes,edges,'a','d',true),['a','b','c','d']);
  assert.equal(shortestPath(nodes,edges,'d','a',true),null);
  assert.deepEqual(shortestPath(nodes,edges,'d','a'),['d','c','b','a']);
  assert.equal(shortestPath(nodes,edges,'a','alone'),null);
  assert.equal(shortestPath(nodes,edges,'missing','a'),null);
  assert.deepEqual(shortestPath(nodes,edges,'a','a'),['a']);
});
test('path explanations preserve original recorded endpoints and parallel relations',()=>{
  const segments=pathSegments(['b','a'],edges);
  assert.equal(segments.length,1);
  assert.equal(segments[0].links.length,2);
  assert.ok(segments[0].links.every(e=>e.from==='a'&&e.to==='b'));
});
test('degree counts unique neighbors and Brandes scores detect a star center',()=>{
  const star=['center','a','b','c'].map(id=>({id}));
  const links=star.slice(1).map(n=>({from:'center',to:n.id}));
  links.push({...links[0]},{from:'center',to:'center'});
  const metrics=graphMetrics(star,links);
  assert.deepEqual(metrics.get('center'),{degree:3,betweenness:1});
  assert.deepEqual(metrics.get('a'),{degree:1,betweenness:0});
});
test('bridge scores distribute equal shortest paths and handle tiny or disconnected graphs',()=>{
  const square=['a','b','c','d'].map(id=>({id}));
  const links=[{from:'a',to:'b'},{from:'b',to:'c'},{from:'c',to:'d'},{from:'d',to:'a'}];
  for(const score of graphMetrics(square,links).values())assert.ok(Math.abs(score.betweenness-1/6)<1e-10);
  assert.equal(graphMetrics([{id:'a'}],[]).get('a').betweenness,0);
  assert.equal(graphMetrics(nodes,edges).get('alone').degree,0);
  assert.equal(graphMetrics(nodes,edges).get('alone').betweenness,0);
});
