import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyQuranChapter,quranReturn} from './quranClient.js';
import {createHash} from 'node:crypto';
const text='An unchanged verse.',digest=createHash('sha256').update(text).digest('hex');
const value=()=>({chapter:1,profile_id:'tanzil-structure-1.0',resources:[{key:'tanzil-uthmani'},{key:'itani-god'}],verses:[{ayah:1,reference:{id:'ref:1:1',chapter:1,ayah_start:1,ayah_end:1},arabic:{text,text_sha256:digest},translation:{text,text_sha256:digest}}]});
test('reader rejects changed text, foreign chapter, duplicate references, and unnamed substitutes',async()=>{
  assert.equal((await verifyQuranChapter(value(),1)).chapter,1);
  for(const mutate of [v=>v.verses[0].translation.text='changed',v=>v.chapter=4,v=>v.verses.push(v.verses[0]),v=>v.resources[1].key='unnamed']){
    const v=value();mutate(v);await assert.rejects(verifyQuranChapter(v,1));
  }
});
test('notebook returns to the same canonical range and named representation',()=>{
  assert.deepEqual(quranReturn({attributes:{quran_resource:'itani-god'}},{locator:'Q 4:59–60'}),{chapter:4,ayah_start:59,ayah_end:60,resource_key:'itani-god'});
  assert.equal(quranReturn({attributes:{}},{locator:'Q 4:59'}),null);
});
