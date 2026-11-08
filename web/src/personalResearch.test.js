import test from 'node:test';
import assert from 'node:assert/strict';
import {parseResearchQuery,matchesResearchProperties,writingStatus,stableEntryLink,stableSourceLink,restoreInspectedWriting,downloadWriting} from './personalResearch.js';
import {recoveryFingerprint} from './recoveryQueue.js';
const body='---\ntype: essay\ntags: [reading, العربية]\nstatus: in progress\ncustom: retained\n---\n\nExact 😀 writing\r\n';
test('metadata search preserves literal prose and matches freeform scalar/list properties',()=>{
 const parsed=parseResearchQuery('source https://example.invalid type:essay tag:العربية property.status:"in progress"');
 assert.equal(parsed.text,'source https://example.invalid');assert.equal(matchesResearchProperties({body},parsed.filters),true);
 assert.equal(matchesResearchProperties({body:'---\ntype: [unfinished\n---'},parsed.filters),false);
 assert.equal(matchesResearchProperties({body},parseResearchQuery('type:note').filters),false);
 assert.throws(()=>parseResearchQuery('type:"incomplete'),/Close/);
 assert.equal(parseResearchQuery("O'Brien").text,"O'Brien");
 assert.equal(matchesResearchProperties({body:'---\ntype: essay\ntype: note\n---'},parseResearchQuery('type:essay').filters),false);
});
test('confirmed recovery is distinct from note persistence and frozen error/conflict takes priority',()=>{
 const payload={value:{body}},session={saved:false,dirty:true,row:null,recoveryPayload:()=>payload,recoveries:new Map(),queue:{status:{phase:'waiting'}}};
 assert.equal(writingStatus(session),'Unsaved writing');session.recoveries.set(0,{confirmedFingerprint:recoveryFingerprint(payload)});
 assert.equal(writingStatus(session),'Recovery copy saved · note not yet saved');
 session.queue.status.phase='error';assert.match(writingStatus(session),/^Save unconfirmed/);
 session.saved=true;assert.equal(writingStatus(session),'Saved');
});
test('stable links omit transient queries and preserve durable Unicode IDs and exact source position',()=>{
 const note=new URL(stableEntryLink('https://example.invalid/?q=private&record=old#section','urn:note:العربية'));
 assert.equal(note.searchParams.get('entry_id'),'urn:note:العربية');assert.equal(note.searchParams.get('q'),null);assert.equal(note.hash,'');
 const source=new URL(stableSourceLink(note.href,{recordId:'source',projectId:null,documentId:'edition',annotationId:'exact',position:0}));
 assert.equal(source.searchParams.get('position'),'0');assert.equal(source.searchParams.get('annotation'),'exact');assert.equal(source.searchParams.get('entry_id'),null);
});
test('inspected revision restore retains current identity/links/anchor and refuses unresolved writing',()=>{
 let patch;const session={saved:true,row:{revision:3},queue:{},anchor:{annotation_id:'original'},edit:value=>patch=value};
 restoreInspectedWriting(session,{body});assert.deepEqual(patch,{body});
 restoreInspectedWriting(session,{body:'---\ntype: skill\n---\nPrevious'});assert.equal(patch.thought_type,'skill');
 session.saved=false;assert.throws(()=>restoreInspectedWriting(session,{body}),/Save or resolve/);
});
test('Markdown export preserves exact current writing rather than rendering or serializing properties',async()=>{
 const originalDocument=globalThis.document,create=URL.createObjectURL,revoke=URL.revokeObjectURL;
 let exported,clicked=false;
 globalThis.document={createElement:()=>({click(){clicked=true;}})};
 URL.createObjectURL=blob=>{exported=blob;return 'blob:synthetic';};URL.revokeObjectURL=()=>{};
 try{downloadWriting(body);assert.equal(await exported.text(),body);assert.equal(clicked,true);}
 finally{globalThis.document=originalDocument;URL.createObjectURL=create;URL.revokeObjectURL=revoke;}
});
