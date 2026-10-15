import assert from 'node:assert/strict';
import test from 'node:test';
import {parseProjects, parseGraph, parseRelease, publicJson, readPublicRoute, publicRouteUrl, safePublicLink} from './publicData.js';

const project = {id:'islam',title:'Islam',privacy:'explicit_approved_projection',graph_data:'graph-'+'a'.repeat(64)+'.json'};
const index = {schema_version:1,delivery:'approved_snapshot_release',projects:[project]};
const graph = {format_version:1,snapshot_id:'publication-'+'a'.repeat(32),project:{id:'islam'},
  publication:{policy:'explicit_owner_selection_v1'},nodes:[{id:'concept:tafsīr',type:'concept',label:'tafsīr'}],edges:[],candidates:[]};

test('approved indexes permit multiple projects and an explicit all-withdrawn empty release', () => {
  assert.equal(parseProjects({...index,projects:[project,{...project,id:'philosophy'}]}).projects.length,2);
  assert.deepEqual(parseProjects({...index,projects:[]}),{projects:[],approved:true});
  assert.throws(()=>parseProjects({schema_version:1,projects:[]}));
  assert.equal(parseProjects({schema_version:1,projects:[{...project,graph_data:'public-graph.json'}]}).approved,false);
});

test('project-controlled graph paths cannot escape the data directory or fall back to legacy content', () => {
  for(const graph_data of ['../private.json','https://example.invalid/private.json','//example.invalid/x.json','%2e%2e.json','public-graph.json','graph-a.json'])
    assert.throws(()=>parseProjects({...index,projects:[{...project,graph_data}]}));
  assert.throws(()=>parseProjects({...index,projects:[project,project]}));
  assert.throws(()=>parseProjects({...index,delivery:'unknown'}));
});

test('a wrong project, unreviewed discovery injection and broken graph identities are refused', () => {
  assert.equal(parseGraph(graph,project,true),graph);
  for(const patch of [{project:{id:'other'}},{candidates:[{title:'Unselected lead'}]},
    {nodes:[...graph.nodes,...graph.nodes]},{edges:[{id:'edge',from:'concept:tafsīr',to:'unknown'}]},
    {publication:null}]) assert.throws(()=>parseGraph({...graph,...patch},project,true));
});

test('export health is explicit about artifact generation and never interpreted as deployment proof', () => {
  const value={format_version:1,status:'exported',delivery:'immutable_approved_snapshot',deployed:false,
    active_projects:1,withdrawn_projects:0,exported_at:'2026-10-15T00:00:00+00:00',last_successful_export_at:'2026-10-15T00:00:00+00:00'};
  assert.equal(parseRelease(value,parseProjects(index)),value);
  for(const patch of [{deployed:true},{active_projects:2},{exported_at:'not a date'},{last_successful_export_at:'old'},{withdrawn_projects:-1}])
    assert.throws(()=>parseRelease({...value,...patch},parseProjects(index)));
});

test('route roundtrip preserves Unicode identities and reloadable project/record/tab state', () => {
  const route={project:'Islam & philosophy',record:'https://example.invalid/tafsīr#معنى',tab:'Records'};
  assert.deepEqual(readPublicRoute(new URL(publicRouteUrl(route,'https://example.invalid/'), 'https://example.invalid/').href),route);
  assert.equal(readPublicRoute('https://example.invalid/#unknown').tab,'Overview');
});

test('public fetch excludes credentials and bypasses browser caching without requesting a legacy fallback', async () => {
  const controller=new AbortController(),calls=[];
  assert.deepEqual(await publicJson('/data/projects.json',controller.signal,async (...args)=>{
    calls.push(args);return {ok:true,json:async()=>index};
  }),index);
  assert.deepEqual(calls,[['/data/projects.json',{signal:controller.signal,cache:'no-store',credentials:'omit'}]]);
  await assert.rejects(publicJson('/data/graph.json',controller.signal,async()=>({ok:false})),/could not be loaded/);
});

test('source links cannot execute scripts or expose credential/query values', () => {
  for(const value of ['javascript:alert(1)','data:text/html,x','https://user:password@example.invalid/','https://example.invalid/?token=x','https://example.invalid/a\nb'])
    assert.equal(safePublicLink(value),null);
  assert.equal(safePublicLink('https://example.invalid/edition#p2'),'https://example.invalid/edition#p2');
});
