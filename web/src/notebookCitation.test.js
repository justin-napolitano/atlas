import test from 'node:test';
import assert from 'node:assert/strict';
import {quoteCapture,quoteMarkdown} from './notebookCitation.js';
test('notebook quotes retain exact Unicode selectors and portable passage identity',()=>{
  const document={id:'edition:1',project_id:'p',text_body:'😀 tafsīr\nثقة',text_sha256:'hash'};
  const capture=quoteCapture('p',document,{start:2,end:8,exact:'tafsīr'});
  assert.equal(capture.exact,'tafsīr');assert.equal(capture.mark_style,'none');assert.equal(capture.body,'');
  assert.match(quoteMarkdown('line one\nline two','A [title]','p. 2','annotation:1'),/^> line one\n> line two\n\n\[A \\\[title\\\].*research-passage:annotation%3A1/);
  assert.throws(()=>quoteCapture('other',document,{start:2,end:8,exact:'tafsīr'}));
  assert.throws(()=>quoteCapture('p',document,{start:1,end:7,exact:'tafsīr'}));
  assert.ok(quoteMarkdown('**literal** <text>','Source','p. 2','a').startsWith('> \\*\\*literal\\*\\* \\<text\\>'));
});
