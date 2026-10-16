import test from 'node:test';
import assert from 'node:assert/strict';
import {unified} from 'unified';
import remarkParse from 'remark-parse';
import {wikiLinks,resolveWiki,notebookGraph,markdownURL,remarkNotebookLinks} from './notebookMarkdown.js';

test('wiki links follow Markdown syntax and exclude code, escaped brackets, and ordinary links',()=>{
  const body='[[Authority|my idea]] and `[[code]]`\n\n```md\n[[fenced]]\n```\n\n\\[[escaped]] and [literal [[link]]](https://example.invalid)\n\n[[note:1]]';
  assert.deepEqual(wikiLinks(body).map(link=>[link.target,link.label]),[['Authority','my idea'],['note:1','note:1']]);
  const tree=unified().use(remarkParse).use(remarkNotebookLinks).runSync(unified().use(remarkParse).parse('[[note:1|hello]]'),{value:'[[note:1|hello]]'});
  assert.equal(tree.children[0].children[0].children[0].url,'notebook:note%3A1');
});
test('note graph preserves explicit direction, id links, ambiguity, and independent isolated notes',()=>{
  const notes=[{id:'a',title:'A',body:'[[b|B]] [[Duplicate]] [[missing]]',links:[],thought_type:'note'},
    {id:'b',title:'B',body:'',links:[{kind:'entry',id:'a',rationale:'Return to the question'}],thought_type:'question'},
    {id:'c',title:'Duplicate',body:'',links:[]},{id:'d',title:'Duplicate',body:'',links:[]}];
  const graph=notebookGraph(notes);
  assert.deepEqual(graph.edges.map(edge=>[edge.from,edge.to,edge.label]),[['a','b','wiki link'],['b','a','explained link']]);
  assert.deepEqual(graph.unresolved.map(link=>link.state),['ambiguous','unresolved']);
  assert.equal(graph.nodes.length,4);assert.equal(resolveWiki('c',notes).note.id,'c');
  assert.equal(resolveWiki('Duplicate',notes).note,null);
  assert.equal(resolveWiki('B',notes,{complete:false}).state,'incomplete');
  assert.equal(resolveWiki('b',notes,{complete:false}).note.id,'b');
});
test('Markdown destinations reject executable, data, and protocol-relative URLs',()=>{
  for(const url of ['javascript:alert(1)','data:text/html,unsafe','//tracking.invalid/x','file:///etc/passwd','vbscript:evil'])assert.equal(markdownURL(url),'');
  for(const url of ['https://example.invalid','mailto:example@example.invalid','#footnote','notebook:note%3A1'])assert.equal(markdownURL(url),url);
});
