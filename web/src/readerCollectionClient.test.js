import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {collectionPreset} from './readerCollectionClient.js';
import {applySourcePreset,sourceIntakePayload} from './sourceIntakeClient.js';

const resource=()=>JSON.parse(fs.readFileSync(new URL('../../src/islam_research/resources/reading-collection-v1.json',import.meta.url)));
test('every actual collection reading maps to exact quotation and bounded durable provenance',()=>{
  const c=resource();c.artifact_sha256='synthetic-api-artifact-field';
  for(const r of c.readings){const preset=collectionPreset(c,r),form=applySourcePreset({intake_uuid:'retained',existing_source_record_id:''},preset),sent=sourceIntakePayload(form,'project');
    assert.equal(sent.excerpt.text,r.text);assert.notEqual(sent.excerpt.text,r.finding.text);assert.equal(sent.coverage_scope,'selected_passage');
    assert.match(sent.intake_context,/agent-prepared paraphrase/);assert.ok(sent.intake_context.length<=2000);
    assert.equal(form.confirmed,false);assert.equal(form.intake_uuid,'retained');assert.equal(sent.excerpt.locator,r.locator);
    if(r.material_kind==='translation'){assert.equal(preset.rights_status,'public_domain');assert.match(preset.rights_basis,/USA/);assert.match(preset.creators,/Rodwell/);}
    else assert.equal(preset.rights_status,'permitted_excerpt');
  }
});
test('preset refuses detached identities and falsely promoted or relabeled analyst findings',()=>{
  const c=resource(),r=c.readings[0];
  assert.throws(()=>collectionPreset(c,{...r}));
  r.finding.wording_mode='quotation';assert.throws(()=>collectionPreset(c,r));r.finding.wording_mode='analyst_paraphrase';
  r.review_state='human_reviewed';assert.throws(()=>collectionPreset(c,r));
});
