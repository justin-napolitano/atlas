import test from 'node:test';
import assert from 'node:assert/strict';
import { selectionOffsets } from './passageSelection.js';

test('DOM UTF-16 offsets convert to stable Unicode positions for emoji and Arabic',()=>{
  const text='😀 A note on tafsīr and التفسير.';
  const start=text.indexOf('tafsīr');
  assert.deepEqual(selectionOffsets(text,start,start+6),{ start:12,end:18,exact:'tafsīr' });
  const arabic=text.indexOf('التفسير');
  assert.equal(selectionOffsets(text,arabic,arabic+7).exact,'التفسير');
});

test('surrogates, vocalization, joined emoji, and flags cannot split midway',()=>{
  for (const [text,start,end] of [['😀',0,1],['بِ',0,1],['👩‍💻',0,2],['🇺🇸',0,2]]) assert.throws(()=>selectionOffsets(text,start,end));
  assert.equal(selectionOffsets('بِ',0,2).end,2);
  assert.equal(selectionOffsets('👩‍💻',0,5).end,3);
});

test('selection bounds and quote limits fail without altering the source',()=>{
  const text='x'.repeat(600);
  for (const [start,end] of [[0,0],[-1,2],[0,601],[0,501],[true,2]]) assert.throws(()=>selectionOffsets(text,start,end));
  assert.equal(selectionOffsets(text,0,500).exact.length,500);
});
