import {test} from 'node:test';
import assert from 'node:assert/strict';
import {withQuranBook} from './quranShelf.js';
import {shelfTarget} from './libraryClient.js';

test('available Qur’an does not fabricate saved identity, notes or reading progress',()=>{
  const [book]=withQuranBook([]);
  assert.equal(book.title,'Qur’an');assert.equal(book.builtin,true);
  for(const field of ['record_id','preferred_edition_id','reading_status','note_count','resume_ayah'])assert.equal(book[field],undefined);
  assert.equal(withQuranBook([],{state:'finished'}).length,0);
  assert.equal(withQuranBook([],{state:'reading'}).length,0);
  assert.equal(withQuranBook([],{scope:'legacy-context'}).length,0);
  assert.equal(withQuranBook([],{query:'philosophy'}).length,0);
  assert.equal(withQuranBook([],{query:'Qur’an'}).length,1);
});

test('one Qur’an book retains the exact most recent edition and legacy resume tuple',()=>{
  const arabic={id:'arabic',title:'Arabic Quran',reader:'quran',availability:'read',source_available:true,preferred_edition_id:'arabic-edition',origin_project_id:'old-context',record_id:'arabic-source',document_id:'arabic-verse',resource_key:'tanzil-uthmani',resume_chapter:4,resume_ayah:59,read_at:'2026-10-18T00:00:00Z',note_count:2};
  const english={...arabic,id:'english',title:'Named translation',preferred_edition_id:'english-edition',record_id:'english-source',document_id:'english-verse',resource_key:'itani-god',resume_ayah:85,read_at:'2026-10-19T00:00:00Z',note_count:3};
  const other={id:'other',title:'Another book',reader:'document'};
  const input=[arabic,other,english],before=structuredClone(input),books=withQuranBook(input);
  assert.equal(books.length,2);assert.equal(books[0].title,'Qur’an');
  assert.deepEqual(shelfTarget(books[0]),shelfTarget(english));
  assert.equal(books[0].note_count,3,'edition counts are never summed into a false work total');
  assert.deepEqual(input,before);assert.equal(books[1],other);
});

test('unavailable or unverified source editions are never promoted to a readable source',()=>{
  const source={id:'withdrawn',title:'Historical source',reader:'quran',availability:'unavailable'};
  assert.equal(withQuranBook([source])[1],source);
  assert.deepEqual(withQuranBook([source],{state:'finished'}),[source]);
});
