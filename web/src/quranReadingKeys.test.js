import test from 'node:test';
import assert from 'node:assert/strict';
import {isReadingAdvanceKey,nextReadingAyah} from './quranReadingKeys.js';
test('Space and Right Arrow are reading actions, while editing, modifiers and controls keep native behavior',()=>{
 const event={key:' ',target:{closest:()=>null}};assert.equal(isReadingAdvanceKey(event),true);assert.equal(isReadingAdvanceKey({...event,key:'ArrowRight'}),true);
 for(const patch of [{key:'ArrowLeft'},{key:'Enter'},{shiftKey:true},{ctrlKey:true},{altKey:true},{metaKey:true},{isComposing:true},{keyCode:229},{defaultPrevented:true},{target:{closest:()=>({})}}])assert.equal(isReadingAdvanceKey({...event,...patch}),false);
});
test('advancing crosses a surah boundary once and stops at the final ayah',()=>{
 const chapters=Array.from({length:114},()=>({ayah_count:7}));chapters[113].ayah_count=6;
 assert.deepEqual(nextReadingAyah(4,3,chapters),{chapter:4,ayah:4});assert.deepEqual(nextReadingAyah(4,7,chapters),{chapter:5,ayah:1});assert.equal(nextReadingAyah(114,6,chapters),null);
 for(const [c,a] of [[0,1],[115,1],[4,0],[4,8],[4,1.5]])assert.equal(nextReadingAyah(c,a,chapters),null);
});
