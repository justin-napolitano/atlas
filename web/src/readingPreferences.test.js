import test from 'node:test';
import assert from 'node:assert/strict';
import {readingDefaults,readingPreferencesKey,normalizeReadingPreferences,readReadingPreferences,writeReadingPreferences,readingStyle} from './readingPreferences.js';
test('reading preferences clamp sizes and reject unknown values without persisting research text',()=>{
  const clean=normalizeReadingPreferences({size:200,notesSize:-1,zoom:900,font:'url(evil)',theme:'unknown',width:'auto',spacing:Infinity,body:'private',record_id:'private'});
  assert.equal(clean.size,48);assert.equal(clean.notesSize,12);assert.equal(clean.zoom,200);assert.equal(clean.font,'serif');assert.equal(clean.theme,'auto');assert.equal(clean.spacing,1.65);
  assert.equal('body' in clean,false);assert.equal('record_id' in clean,false);
  for(const value of [null,[],true,'bad'])assert.deepEqual(normalizeReadingPreferences(value),readingDefaults);
});
test('appearance roundtrips through device-local storage and blocked storage stays usable',()=>{
  const memory=new Map(),storage={getItem:k=>memory.get(k),setItem:(k,v)=>memory.set(k,v)};
  assert.deepEqual(readReadingPreferences(storage),readingDefaults);
  const next={...readingDefaults,font:'sans',notesSize:21,zoom:150,mode:'pages',theme:'paper'};
  assert.equal(writeReadingPreferences(storage,next),true);assert.deepEqual(readReadingPreferences(storage),next);assert.deepEqual([...memory.keys()],[readingPreferencesKey]);
  const blocked={getItem:()=>{throw new Error();},setItem:()=>{throw new Error();}};
  assert.deepEqual(readReadingPreferences(blocked),readingDefaults);assert.equal(writeReadingPreferences(blocked,next),false);
  memory.set(readingPreferencesKey,'broken json');assert.deepEqual(readReadingPreferences(storage),readingDefaults);
});
test('reading magnification changes source and notes independently and only emits bounded styles',()=>{
  const style=readingStyle({...readingDefaults,size:24,notesSize:18,zoom:150,width:'narrow'});
  assert.equal(style['--reading-size'],'36px');assert.equal(style['--notes-size'],'27px');assert.equal(style['--reading-width'],'45ch');
  assert.equal(readingStyle({font:'url(evil)'})['--reading-font'].includes('url('),false);
});
