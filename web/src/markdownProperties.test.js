import test from 'node:test';
import assert from 'node:assert/strict';
import {markdownProperties,propertyCompletion,propertyTypeChange,frontmatterEdit} from './markdownProperties.js';
import {markdownBlocks} from './liveMarkdown.js';
import {captureTitle} from './connectedWriting.js';
import {wikiTargetAt} from './pageLinks.js';

const body='---\ntype: skill # keep this\ntags: [reading, العربية]\naliases: [Close reading]\ncustom:\n  source: "https://example.invalid"\n---\n\n# Synthetic reading\n\nA paragraph.\n';
test('bounded YAML properties preserve source and reject ambiguous/unsafe headers',()=>{
 const result=markdownProperties(body);assert.equal(result.status,'valid');assert.equal(result.type,'skill');assert.deepEqual(result.tags,['reading','العربية']);assert.deepEqual(result.aliases,['Close reading']);
 for(const header of ['type: [skill','type: skill\ntype: principle','type: &a skill\ntags: [*a]','type: !!js/function function(){}','x: '+ '['.repeat(15)+'a'+']'.repeat(15)]){
  const properties=markdownProperties('---\n'+header+'\n---\nText');assert.equal(properties.type,undefined,header);assert.notEqual(properties.status,'valid',header);
 }
 assert.equal(markdownProperties('---\ntype: skill').status,'unfinished');
 assert.equal(markdownProperties('---\ntype: skill\nx: '+ 'a'.repeat(8200)+'\n---').type,undefined);
 assert.equal(markdownProperties('---\ntype: no-such-role\n---').type,null);
 assert.equal(captureTitle(body),'Synthetic reading');assert.equal(captureTitle('---\ntype: skill'),'Untitled note');
 const first=markdownBlocks(body)[0];assert.equal(first.type,'yaml');assert.equal(body.slice(first.from,first.to),first.source);
});
test('changing roles patches only the scalar, preserving comments, body and unknown fields',()=>{
 assert.equal(propertyTypeChange(body,'principle'),body.replace('type: skill','type: principle'));
 assert.equal(propertyTypeChange('plain body','skill'),'plain body');
 assert.equal(propertyTypeChange('---\ntype: [unfinished\n---\nText','skill'),null);
 const noType='---\ntags: [reading]\n---\nText';assert.equal(propertyTypeChange(noType,'skill'),'---\ntags: [reading]\ntype: skill\n---\nText');
 const edit=frontmatterEdit(body);assert.equal(body.slice(edit.selection.anchor,edit.selection.head),'skill');
 const fresh=frontmatterEdit('Existing writing','principle');assert.equal(fresh.changes.insert.slice(fresh.selection.anchor,fresh.selection.head),'principle');
});
test('completion is contextual, handles keyboard role/tag edits, and lets Enter leave a completed value',()=>{
 const source='---\ntype: pri\n---\nBody',cursor=source.indexOf('pri')+3;
 const menu=propertyCompletion(source,cursor);assert.deepEqual(menu.items.map(row=>row.insert),['principle']);assert.equal(source.slice(menu.from,menu.to),'pri');
 assert.deepEqual(propertyCompletion(source.replace('pri','principle'),cursor+6).items,[]);
 const tags='---\ntags: [read';assert.deepEqual(propertyCompletion(tags,tags.length,[{body}]).items.map(row=>row.insert),['reading']);
 assert.equal(propertyCompletion('Text\ntype: sk',13),null);
 assert.equal(propertyCompletion('```yaml\ntype: sk',16),null);
 const field='---\nty';assert.equal(propertyCompletion(field,field.length).items[0].insert,'type: ');
});
test('keyboard link following resolves only the wiki link under the cursor',()=>{
 const text='Words [[urn:research:notebook:synthetic|A page]] here';
 assert.equal(wikiTargetAt(text,20),'urn:research:notebook:synthetic');
 assert.equal(wikiTargetAt(text,text.length),null);
 for(const text of ['`[[Hidden]]`','\\[[Hidden]]','```\n[[Hidden]]\n```'])assert.equal(wikiTargetAt(text,text.indexOf('Hidden')+3),null);
});
