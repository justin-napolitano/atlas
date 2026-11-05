import test from 'node:test';
import assert from 'node:assert/strict';
import { ReadingWorkspace, WorkspaceError, blankState, markdownDraft, workspaceAPI } from './workspaceClient.js';

const initial = () => blankState('urn:test:source', 'test-project');
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

test('reopening a saved record adopts the newer notebook-visible note without replacing unfinished writing',()=>{
  const store=new ReadingWorkspace({}),first=initial();store.adopt(first);
  const newer={...first,revision:3,note:'New note from another session',reading:'read'};store.adopt(newer);
  assert.equal(store.entries.get(first.record_id).draft.note,newer.note);
  store.edit(first.record_id,{note:'Unfinished local interpretation'});store.adopt({...newer,revision:4,note:'Later cloud version'});
  assert.equal(store.entries.get(first.record_id).draft.note,'Unfinished local interpretation');assert.equal(store.entries.get(first.record_id).server.revision,3);
});

test('signed-owner client uses same-origin cookies and explicit JSON write header', async () => {
  const calls = [];
  const api = workspaceAPI(async (url, options) => { calls.push({ url, options }); return new Response(JSON.stringify({ revision: 1 }), { headers: { 'content-type': 'application/json' } }); });
  await api.request('record', { record_id: 'urn:source?x=1&y=2' });
  await api.save({ ...initial(), expected_revision: 0 });
  await api.post('reading/documents',{ text:'Synthetic private excerpt' });
  assert.equal(new URL(calls[0].url, 'https://synthetic.invalid').searchParams.get('record_id'), 'urn:source?x=1&y=2');
  assert.equal(calls[0].options.credentials, 'same-origin');
  assert.equal(calls[1].options.headers['X-Research-Write'], '1');
  assert.equal(calls[1].options.method, 'PUT');
  assert.equal(JSON.parse(calls[1].options.body).expected_revision, 0);
  assert.equal(calls[2].options.method,'POST');
  assert.equal(calls[2].options.headers['X-Research-Write'],'1');
});

test('HTML sign-in pages and API conflicts are distinguished without leaking response text', async () => {
  const api = workspaceAPI(async () => new Response('SYNTHETIC-PRIVATE-ERROR', { headers: { 'content-type': 'text/html' } }));
  await assert.rejects(api.request('me'), error => error.status === 401 && !error.message.includes('SYNTHETIC'));
  const other = workspaceAPI(async () => new Response(JSON.stringify({ current: { ...initial(), revision: 2 } }), { status: 409, headers: { 'content-type': 'application/problem+json' } }));
  await assert.rejects(other.save({}), error => error.current.revision === 2);
});

test('read and skip choices persist using the last confirmed revision', async () => {
  const requests = [];
  const store = new ReadingWorkspace({ save: async value => { requests.push(value); return { ...value, revision: value.expected_revision+1, read_at: '2026-10-15T00:00:00Z' }; } });
  store.adopt(initial()); store.edit('urn:test:source', { reading: 'read', decision: 'not_relevant' });
  await store.save('urn:test:source');
  assert.equal(store.entries.get('urn:test:source').status, 'saved');
  store.edit('urn:test:source', { note: 'Synthetic reading note' }); await store.save('urn:test:source');
  assert.equal(requests[1].expected_revision, 1);
  assert.equal(requests[1].reading, 'read');
  assert.equal(requests[1].decision, 'not_relevant');
  assert.equal(store.hasDrafts(), false);
});

test('typing during an in-flight save cannot replace the newer draft', async () => {
  const wait = deferred();
  const store = new ReadingWorkspace({ save: () => wait.promise });
  store.adopt(initial()); store.edit('urn:test:source', { note: 'First draft' });
  const pending = store.save('urn:test:source'); await tick();
  store.edit('urn:test:source', { note: 'Newer draft' });
  wait.resolve({ ...initial(), note: 'First draft', revision: 1 }); await pending;
  const entry = store.entries.get('urn:test:source');
  assert.equal(entry.server.note, 'First draft'); assert.equal(entry.draft.note, 'Newer draft'); assert.equal(entry.status, 'unsaved');
});

test('a second explicit save is serialized against the new cloud revision', async () => {
  const wait = deferred(), requests = [];
  const store = new ReadingWorkspace({ save: value => { requests.push(value); return requests.length === 1 ? wait.promise : Promise.resolve({ ...value, revision: 2 }); } });
  store.adopt(initial()); store.edit('urn:test:source', { note: 'First' });
  const pending = store.save('urn:test:source'); await tick();
  store.edit('urn:test:source', { note: 'Second' }); store.save('urn:test:source');
  assert.equal(requests.length, 1);
  wait.resolve({ ...initial(), note: 'First', revision: 1 }); await pending; await tick();
  assert.equal(requests[1].expected_revision, 1); assert.equal(requests[1].note, 'Second');
  assert.equal(store.entries.get('urn:test:source').status, 'saved');
});

test('conflicts retain both drafts and require an explicit resolution', async () => {
  let fail = true; const requests = [];
  const current = { ...initial(), note: 'Other machine note', reading: 'read', revision: 7 };
  const store = new ReadingWorkspace({ save: async value => { requests.push(value); if (fail) throw new WorkspaceError(409, current); return { ...value, revision: 8 }; } });
  store.adopt(initial()); store.edit('urn:test:source', { note: 'My draft' }); await store.save('urn:test:source');
  const entry = store.entries.get('urn:test:source');
  assert.equal(entry.status, 'conflict'); assert.equal(entry.draft.note, 'My draft'); assert.equal(entry.current.note, 'Other machine note');
  await store.save('urn:test:source'); assert.equal(requests.length, 1);
  fail = false; store.resolve('urn:test:source','draft'); await tick();
  assert.equal(requests[1].expected_revision, 7); assert.equal(entry.server.note, 'My draft');
  // Selecting the cloud version never sends another write.
  entry.current = current; entry.status = 'conflict'; store.resolve('urn:test:source','cloud');
  assert.equal(entry.draft.note, 'Other machine note'); assert.equal(requests.length, 2);
});

test('offline failures preserve notes and navigation cannot adopt stale data over a draft', async () => {
  const store = new ReadingWorkspace({ save: async () => { throw new TypeError('offline'); } });
  store.adopt(initial()); store.edit('urn:test:source', { note: 'Unsaved offline note' }); await store.save('urn:test:source');
  store.adopt({ ...initial(), note: 'Stale fetch' }); store.adopt(blankState('other','test-project'));
  assert.equal(store.entries.get('urn:test:source').draft.note, 'Unsaved offline note');
  assert.equal(store.entries.get('urn:test:source').status, 'error'); assert.equal(store.hasDrafts(), true);
  assert.match(await markdownDraft({ id:'urn:test:source', title:'Synthetic source' }, store.entries.get('urn:test:source')), /base_revision: 0/);
  assert.match(await markdownDraft({ id:'urn:test:source', title:'Synthetic source' }, store.entries.get('urn:test:source')), /Unsaved offline note/);
});

test('lost successful response can be confirmed by matching revision-conflict state', async () => {
  const store = new ReadingWorkspace({ save: async value => { throw new WorkspaceError(409,{ ...value, revision: 3 }); } });
  store.adopt(initial()); store.edit('urn:test:source',{ note:'Already committed' }); await store.save('urn:test:source');
  assert.equal(store.entries.get('urn:test:source').status,'saved');
  assert.equal(store.entries.get('urn:test:source').server.revision,3);
});
