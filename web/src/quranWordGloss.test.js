import test from 'node:test';
import assert from 'node:assert/strict';
import {selectedWordGlosses} from './quranWordGloss.js';
const text='😀 كَلِمَة أُخْرَى',selection={chapter:4,ayah:59,text_sha256:'synthetic-digest',start:3,end:9};
const value=()=>({chapter:4,ayah:59,text_sha256:selection.text_sha256,resource_key:'tanzil-uthmani',words:[{position:1,start:2,end:9,arabic:'كَلِمَة',translation:'Synthetic first word'},{position:2,start:10,end:17,arabic:'أُخْرَى',translation:'Synthetic second word'}]});
test('word translation uses Unicode source positions and expands a partial selection to whole word glosses',()=>{
  const chars=Array.from(text),v=value();v.words=v.words.map((word,i)=>({...word,start:i?10:2,end:i?chars.length:9,arabic:chars.slice(i?10:2,i?chars.length:9).join('')}));
  assert.equal(selectedWordGlosses(v,selection,text).length,1);
  assert.equal(selectedWordGlosses(v,{...selection,end:chars.length},text).length,2);
  for(const patch of [{chapter:3},{ayah:60},{text_sha256:'other'},{resource_key:'itani-god'}])assert.throws(()=>selectedWordGlosses({...v,...patch},selection,text));
  for(const patch of [{start:-1},{end:100},{arabic:'changed'},{translation:''},{position:8}])assert.throws(()=>selectedWordGlosses({...v,words:[{...v.words[0],...patch},v.words[1]]},selection,text));
});
