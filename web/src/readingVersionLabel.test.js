import test from 'node:test';
import assert from 'node:assert/strict';
import {readingVersionLabel} from './readingVersionLabel.js';
test('edition control stays compact without changing stored provenance',()=>{
  const version={edition:'Historical Rodwell translation, digital text and print uncertainty',locator:'Q 4:59; full location details'};
  const before=JSON.stringify(version);
  assert.equal(readingVersionLabel(version),'Historical Rodwell translation · Q 4:59');
  assert.equal(JSON.stringify(version),before);
  assert.ok(readingVersionLabel({edition:'a'.repeat(200),locator:'ب'.repeat(200)}).length<=123);
});
