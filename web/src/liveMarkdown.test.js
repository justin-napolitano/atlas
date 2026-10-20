import test from 'node:test';
import assert from 'node:assert/strict';
import {EditorState} from '@codemirror/state';
import {history,undo,redo} from '@codemirror/commands';
import {markdownBlocks,blockSelected} from './liveMarkdown.js';
const source='# Authority\n\nEnglish and العَرَبِيَّة **bold** with [[urn:research:notebook:synthetic|a note]].\n\n| School | Date |\n| --- | --- |\n| A | 100 |\n\nA footnote[^1] and [reference][edition].\n\n```js\nconst value = "<script>";\n```\n\n[^1]: A located footnote.\n\n[edition]: https://example.org/synthetic\n';
test('presentation ranges preserve Markdown, citations, RTL and definitions',()=>{
 const blocks=markdownBlocks(source);assert.ok(blocks.some(row=>row.type==='table'));assert.ok(blocks.some(row=>row.type==='code'));assert.ok(blocks.some(row=>row.type==='footnoteDefinition'));
 for(const block of blocks){assert.equal(source.slice(block.from,block.to),block.source);assert.ok(block.definitions.includes('[^1]:'));}
 assert.equal(blockSelected(blocks[0],[{from:0,to:0}]),true);assert.equal(blockSelected(blocks[1],[{from:0,to:0}]),false);assert.equal(source,EditorState.create({doc:source}).doc.toString());
});
test('transactions preserve source with undo, redo and mixed-script insertion',()=>{
 let state=EditorState.create({doc:source,extensions:[history()]});const target={get state(){return state;},dispatch(transaction){state=transaction.state;}};
 const offset=source.indexOf('العَرَبِيَّة');state=state.update({changes:{from:offset,to:offset,insert:'ملاحظة '},selection:{anchor:offset+7}}).state;
 assert.ok(state.doc.toString().includes('ملاحظة العَرَبِيَّة'));assert.equal(undo(target),true);assert.equal(state.doc.toString(),source);assert.equal(redo(target),true);assert.ok(state.doc.toString().includes('ملاحظة العَرَبِيَّة'));
});
