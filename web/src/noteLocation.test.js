import test from 'node:test';
import assert from 'node:assert/strict';
import {noteLocationLabel} from './noteLocation.js';

test('Quran notes use the bound ayah/range instead of percentages within a verse',()=>{
  const document={text_body:'A short translation.'};
  assert.equal(noteLocationLabel(document,0,'Q 4:85'),'Q 4:85');
  assert.equal(noteLocationLabel(document,15,'Q 4:85–86'),'Q 4:85–86');
});
test('generic reading notes use Unicode paragraph positions without moving stored anchors',()=>{
  const text='😀 First é paragraph.\n\nثانٍ\n\nThird paragraph.',document={text_body:text};
  assert.equal(noteLocationLabel(document,0),'Paragraph 1');
  assert.equal(noteLocationLabel(document,Array.from(text.slice(0,text.indexOf('ث'))).length),'Paragraph 2');
  assert.equal(noteLocationLabel(document,Array.from(text).length),'Paragraph 3');
  assert.equal(noteLocationLabel(document,-1),'Reading location');
  assert.equal(document.text_body,text);
});
