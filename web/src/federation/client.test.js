import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { DraftSession, normalizeNewlines, preserveLineEndings } from './client.js';
globalThis.crypto ||= webcrypto;
const page = { page_id: 'synthetic-page', version: 0, synced_version: 0, content: { title: 'Synthetic', body: 'العربية\r\n日本語\nlast\r\n', state: 'active' } };
test('native input preserves untouched mixed newlines and exact Unicode', () => {
  assert.equal(preserveLineEndings(page.content.body, normalizeNewlines(page.content.body)), page.content.body);
  assert.equal(preserveLineEndings(page.content.body, normalizeNewlines(page.content.body).replace('日本語', '日本語 👩🏽‍💻')), 'العربية\r\n日本語 👩🏽‍💻\nlast\r\n');
});
test('autosave retries the exact immutable local intent and retains newer writing', async () => {
  const requests = []; let reject = true;
  const client = { page: () => 'synthetic', request: async (_path, request) => { requests.push(structuredClone(request)); if (reject) throw Error('Offline local bridge'); return { ...page, content: request.content, version: request.expected_version + 1 }; } };
  const session = new DraftSession(client, 'alice', 'brain', page);
  session.edit({ body: 'First 日本語' }); clearTimeout(session.timer);
  await assert.rejects(session.flush());
  session.edit({ body: 'Newer العربية' }); clearTimeout(session.timer); reject = false;
  await session.flush();
  assert.deepEqual(requests[0], requests[1]); assert.notEqual(requests[1].edit_id, requests[2].edit_id);
  assert.equal(session.value.body, 'Newer العربية'); assert.equal(session.saved, true);
});
test('IME composition defers saves and native undo restores exact raw writing', async () => {
  let calls = 0; const client = { page: () => 'synthetic', request: async (_p, request) => { calls++; return { ...page, content: request.content, version: request.expected_version + 1 }; } };
  const session = new DraftSession(client, 'alice', 'brain', page);
  session.composition(true); session.edit({ body: '日本語 composition' }); await session.flush(); assert.equal(calls, 0);
  session.edit({ body: normalizeNewlines(page.content.body) }, 'historyUndo'); assert.equal(session.value.body, page.content.body);
  session.composition(false); clearTimeout(session.timer); await session.flush(); assert.equal(session.saved, true);
});
test('a background page read cannot replace an unsaved local draft', () => {
  const session = new DraftSession({}, 'alice', 'brain', page); session.edit({ body: 'Retained unsaved edit' }); clearTimeout(session.timer);
  session.adopt({ ...page, content: { ...page.content, body: 'Other writing' }, version: 9 });
  assert.equal(session.value.body, 'Retained unsaved edit'); assert.equal(session.version, 0);
});
test('an idempotent retry cannot acknowledge another tab’s newer local writing', async () => {
  const current = { ...page, version: 2, content: { ...page.content, body: 'Other tab writing' } };
  const client = { page: () => 'synthetic', request: async () => current };
  const session = new DraftSession(client, 'alice', 'brain', page); session.edit({ body: 'Retained original draft' }); clearTimeout(session.timer);
  await assert.rejects(session.flush(), error => error.code === 'local_version_conflict');
  assert.equal(session.saved, false); assert.equal(session.value.body, 'Retained original draft'); assert.equal(session.version, 0);
});
