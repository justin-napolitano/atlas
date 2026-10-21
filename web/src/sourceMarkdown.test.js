import test from 'node:test';
import assert from 'node:assert/strict';
import {sourceMarkdownPlan,planText} from './sourceMarkdown.js';
const walk=(node,found=[])=>{found.push(node);node.parts?.forEach(child=>walk(child,found));return found;};
test('formatted reading preserves every original character and source range',()=>{
 for(const source of ['# Heading\n\nA **strong** and *gentle* thought.','## العربية 😀\n\nBefore `code` and ~~removed~~ after.','- One\n- Two\n\n1. First\n2. Next','| Term | Meaning |\n| --- | --- |\n| tafsīr | Commentary |','```js\nconst a = 1;\n```\n','A [citation](https://example.invalid/paper) follows.','> Quoted\n> reading','A &amp; entity and \\*escape\\*.','<script>synthetic()</script>\n![image](https://example.invalid/tracker)']){
  const plan=sourceMarkdownPlan(source);assert.equal(planText(source,plan),source);
  const leaves=walk(plan).filter(node=>!node.parts);let offset=0;
  for(const leaf of leaves){assert.equal(leaf.from,offset);assert.ok(leaf.to>=leaf.from);offset=leaf.to;}assert.equal(offset,source.length);
 }
});
test('syntax is hidden only inside source-proven structures, with ambiguous text literal',()=>{
 const source='# Heading\n\nA **bold** word.';const nodes=walk(sourceMarkdownPlan(source));
 assert.ok(nodes.some(node=>node.type==='heading'));assert.ok(nodes.some(node=>node.type==='strong'));
 assert.equal(nodes.filter(node=>node.hidden).map(node=>source.slice(node.from,node.to)).join(''),'# ****');
 const escaped=walk(sourceMarkdownPlan('An &amp; entity.'));assert.ok(!escaped.some(node=>node.hidden));
 const unsafe=walk(sourceMarkdownPlan('<img src=x onerror=synthetic()>'));assert.ok(unsafe.every(node=>node.type==='root'||node.type==='literal'));
});
