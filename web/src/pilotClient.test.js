import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {savePilotWrite,verifyPilotImport,verifyPilotResource,verifyVerseRows} from './pilotClient.js';
const sha=text=>createHash('sha256').update(text).digest('hex');
const resource={resource_id:'synthetic:resource',label:'Synthetic test resource',source_notice:'Synthetic source notice',reading_note:'No edition inference',review_limit:'Synthetic fixture only',attribution_url:'https://tanzil.net/',verses:[59,83].map(ayah=>({chapter:4,ayah_start:ayah,ayah_end:ayah,text:`اختبار ${ayah}`,text_sha256:sha(`اختبار ${ayah}`),reference:{id:`synthetic:4:${ayah}`,label:`Q 4:${ayah}`}}))};

test('pilot validates both bounded exact text digests and preserves Arabic bytes',async()=>{
  assert.deepEqual(await verifyPilotResource(resource),resource);
  await assert.rejects(verifyPilotResource({...resource,verses:[{...resource.verses[0],text:'changed'},resource.verses[1]]}));
  await assert.rejects(verifyPilotResource({...resource,verses:[resource.verses[0],resource.verses[0]]}));
  await assert.rejects(verifyPilotResource({...resource,attribution_url:'https://example.invalid/'}));
});

test('pilot readback requires the same document, annotation, quote, notice and project',async()=>{
  const verse=resource.verses[0],sent={project_id:'p',chapter:4,ayah:59},result={project_id:'p',resource_id:resource.resource_id,record_id:'s',document_id:'d',annotation_id:'a',material_id:'m'};
  const doc={id:'d',project_id:'p',source_record_id:'s',text_body:verse.text,text_sha256:verse.text_sha256,source_notice:resource.source_notice};
  const capture={annotation:{id:'a',project_id:'p',document_id:'d',text_sha256:verse.text_sha256,exact:verse.text},anchor:{anchored:true}};
  await verifyPilotImport({request:async path=>path==='reading/document' ? doc : capture},result,sent,resource);
  await assert.rejects(verifyPilotImport({request:async path=>path==='reading/document' ? {...doc,source_notice:''} : capture},result,sent,resource));
  await assert.rejects(verifyPilotImport({request:async path=>path==='reading/document' ? doc : {...capture,anchor:{anchored:false}}},result,sent,resource));
  await assert.rejects(verifyPilotImport({}, {...result,project_id:'other'},sent,resource));
});

test('uncertain verse saves freeze original requests; validation permits initial correction only',async()=>{
  let form={rationale:'original'},calls=[];
  const update=value=>{form=value;};
  assert.equal(await savePilotWrite({api:{post:async(p,v)=>{calls.push(v);throw {status:503};}},path:'pilot',form,payload:{rationale:'original'},update,verify:async()=>{}}),null);
  const original=structuredClone(form.sent);
  await savePilotWrite({api:{post:async(p,v)=>{calls.push(v);return {id:'saved'};}},path:'pilot',form,payload:{rationale:'changed'},update,verify:async()=>{}});
  assert.deepEqual(calls,[original,original]);
  form={};await savePilotWrite({api:{post:async()=>{throw {status:422};}},path:'pilot',form,payload:{},update,verify:async()=>{}});assert.equal(form.sent,null);
  form={sent:original};await savePilotWrite({api:{post:async()=>{throw {status:422};}},path:'pilot',form,payload:{},update,verify:async()=>{}});assert.deepEqual(form.sent,original);
});

test('verse material refuses foreign projects, missing bounds and unrelated ranges',()=>{
  const row={project_id:'p',chapter:4,ayah_start:59,ayah_end:59,source_record_id:'s',annotation_id:'a',document_id:'d',reference:{label:'Q 4:59'}};
  assert.deepEqual(verifyVerseRows([row],'p',4,59,59),[row]);
  for(const patch of [{project_id:'other'},{ayah_start:undefined},{ayah_end:58},{ayah_start:83,ayah_end:83}])assert.throws(()=>verifyVerseRows([{...row,...patch}],'p',4,59,59));
});
