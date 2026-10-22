import test from 'node:test';
import assert from 'node:assert/strict';
import {unified} from 'unified';
import remarkParse from 'remark-parse';
import {SUBPAGES_MARKER,remarkSubpageContents,tocCommandCompletion} from './subpageContents.js';
test('contents is explicit and only the exact standalone marker activates it',()=>{
 const parse=text=>unified().use(remarkParse).use(remarkSubpageContents).runSync(unified().use(remarkParse).parse(text));
 assert.equal(parse(SUBPAGES_MARKER).children[0].type,'subpageContents');
 for(const text of ['An ordinary note','`'+SUBPAGES_MARKER+'`','```md\n'+SUBPAGES_MARKER+'\n```',SUBPAGES_MARKER+'<script>unsafe</script>'])assert.ok(!parse(text).children.some(node=>node.type==='subpageContents'));
});
test('/toc is a keyboard insertion in ordinary page text, not code or properties',()=>{
 const text='A note\n\n/toc',query=tocCommandCompletion(text,text.length);assert.equal(query.kind,'toc-command');assert.equal(query.items[0].insert,SUBPAGES_MARKER+'\n\n');assert.equal(text.slice(query.from,query.to),'/toc');
 for(const text of ['Text /toc','    /toc','```md\n/toc','---\ntype: note\n/toc'])assert.equal(tocCommandCompletion(text,text.length),null);
});

test('contents markers do not become automatic page names',async()=>{
 const {captureTitle}=await import('./connectedWriting.js');
 assert.equal(captureTitle(SUBPAGES_MARKER+'\n\n# A real title'),'A real title');assert.equal(captureTitle(SUBPAGES_MARKER),'Untitled note');
});
