import test from 'node:test';
import assert from 'node:assert/strict';
import {wikiCompletion,pageWikiText,pageLinksFor,PAGE_LINK_REASON} from './pageLinks.js';

test('page completion follows unfinished Markdown and ignores code, escapes, links and aliases',()=>{
 for(const text of ['[[','A thought [[Aut','العربية [[معنى']){
  const result=wikiCompletion(text,text.length);assert.ok(result);assert.equal(text.slice(result.from,result.to),result.raw);
 }
 for(const text of ['\\[[escaped','```md\n[[code','`[[code`','[[page|alias','[label [[nested]]](https://example.invalid)'])assert.equal(wikiCompletion(text,text.length),null,text);
 const complete='[[Auth]]';assert.equal(wikiCompletion(complete,6).to,8);
});
test('chosen pages use stable identities and inert readable labels',()=>{
 const row={id:'urn:research:notebook:synthetic',title:'A | page [test]\nالعربية'};
 assert.equal(pageWikiText(row),'[[urn:research:notebook:synthetic|A   page  test  العربية]]');
});
test('navigation metadata tracks actual parsed Markdown without deleting explained connections',()=>{
 const target={id:'note:target',title:'Target'},manual={kind:'entry',id:'note:manual',rationale:'My explicitly explained connection'};
 const links=pageLinksFor('A [[note:target|Target]] and `[[note:ignored]]`',[manual],target);
 assert.deepEqual(links,[manual,{kind:'entry',id:target.id,rationale:PAGE_LINK_REASON}]);
 assert.deepEqual(pageLinksFor('Removed the reference.',links),[manual]);
 assert.deepEqual(pageLinksFor('[[unknown]]',[]),[]);
 assert.deepEqual(pageLinksFor('[[note:manual|Manual]]',links),[manual]);
});

test('undo restores generated backlinks without keeping deleted links',()=>{
 const memory=new Set(),target={id:'note:undo'};
 const body='[[note:undo|Undo target]]';
 const initial=pageLinksFor(body,[],target,memory);
 const removed=pageLinksFor('',initial,null,memory);
 assert.deepEqual(removed,[]);
 assert.deepEqual(pageLinksFor(body,removed,null,memory),initial);
});
