import test from 'node:test';
import assert from 'node:assert/strict';
import {saveVerseLink,verseLinkKey,verseLinkPayload,verifyVerseLink,verifyVerseLinkRow} from './verseLinksClient.js';

const annotation={id:'annotation',project_id:'project',document_id:'document',text_sha256:'synthetic-hash',exact:'😀 التفسير and tafsīr'};
const form={request_uuid:'retained-request',chapter:'4',ayah_start:'59',ayah_end:'',material_kind:'scholarship',link_kind:'discussion',
  attribution:'Synthetic source author',source_scope:'Only this selected paragraph',rationale:'Compare the stated interpretation',assertion_mode:'paraphrase',assertion_text:'',confirmed:true};
const result={id:'material',project_id:'project',revision:1};
const rowFor=sent=>({...sent,...result,document_id:annotation.document_id,text_sha256:annotation.text_sha256,selected_quote:annotation.exact,
  reference:{chapter:sent.chapter,ayah_start:sent.ayah_start,ayah_end:sent.ayah_end,id:'verse:4:59',label:'Q 4:59'}});

test('verse payload requires explicit scoped owner connection and never manufactures a citation',()=>{
  const sent=verseLinkPayload(form,'project',annotation);
  assert.equal(sent.ayah_end,59);assert.equal(sent.link_kind,'discussion');assert.equal(sent.citation_basis,'none');assert.equal(sent.citation_id,null);
  assert.equal(sent.assertion_mode,'none');assert.equal(sent.assertion_text,'');assert.equal(sent.owner_confirmed,true);
  for(const patch of [{confirmed:false},{attribution:' '},{source_scope:''},{rationale:''},{chapter:'115'},{ayah_end:'58'},{link_kind:'explicit_citation'},{material_kind:'translation'}])
    assert.throws(()=>verseLinkPayload({...form,...patch},'project',annotation));
  assert.throws(()=>verseLinkPayload(form,'other',annotation));
});
test('interpretations distinguish exact Arabic/Unicode quotation from attributed paraphrase',()=>{
  const input={...form,link_kind:'interpretive_claim',assertion_mode:'quotation',assertion_text:annotation.exact};
  assert.equal(verseLinkPayload(input,'project',annotation).assertion_text,annotation.exact);
  assert.throws(()=>verseLinkPayload({...input,assertion_text:'Changed quotation'},'project',annotation));
  assert.equal(verseLinkPayload({...input,assertion_mode:'paraphrase',assertion_text:'The named author proposes a scoped interpretation.'},'project',annotation).assertion_mode,'paraphrase');
});
test('readback binds project, selected source hash/wording, range, role, and asserted interpretation',async()=>{
  const sent=verseLinkPayload(form,'project',annotation),row=rowFor(sent);
  await verifyVerseLink({request:async()=>row},result,sent,annotation);
  for(const patch of [{project_id:'other'},{annotation_id:'other'},{document_id:'other'},{text_sha256:'changed'},{selected_quote:'changed'},{link_kind:'explicit_citation'},{material_kind:'tafsir'},{ayah_start:83},{assertion_text:'Added claim'}])
    await assert.rejects(verifyVerseLink({request:async()=>({...row,...patch})},result,sent,annotation));
  assert.throws(()=>verifyVerseLinkRow({...row,reference:{...row.reference,chapter:3}},'project',annotation));
});
test('unknown outcome retains UUID and exact payload, then retries and confirms one source-bound connection',async()=>{
  const sent=verseLinkPayload(form,'project',annotation);let current=form;
  const update=value=>{current=value;};
  await saveVerseLink({api:{post:async()=>{throw {status:503};}},form:current,payload:sent,annotation,update});
  assert.deepEqual(current.sent,sent);let posted;
  const saved=await saveVerseLink({api:{post:async(_path,value)=>{posted=value;return result;},request:async()=>rowFor(sent)},form:current,payload:{...sent,chapter:2},annotation,update});
  assert.deepEqual(posted,sent);assert.equal(saved.id,'material');
});
test('initial rejection allows editing, but later rejection or incorrect readback keeps uncertain draft frozen',async()=>{
  const sent=verseLinkPayload(form,'project',annotation);let current;
  const reject={post:async()=>{throw {status:422};}};
  await saveVerseLink({api:reject,form,payload:sent,annotation,update:value=>{current=value;}});assert.equal(current.sent,null);
  await saveVerseLink({api:reject,form:{...form,sent},payload:sent,annotation,update:value=>{current=value;}});assert.deepEqual(current.sent,sent);
  const saved=await saveVerseLink({api:{post:async()=>result,request:async()=>({...rowFor(sent),project_id:'other'})},form,payload:sent,annotation,update:value=>{current=value;}});
  assert.equal(saved,null);assert.deepEqual(current.sent,sent);
  assert.notEqual(verseLinkKey('project','annotation'),verseLinkKey('other','annotation'));
});
