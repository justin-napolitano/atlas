import test from 'node:test';
import assert from 'node:assert/strict';
import {contextProperties,verifyContext,verifyComparisonDocument} from './readingContext.js';

test('graph navigation preserves incoming/outgoing direction and refuses mismatched projects/endpoints',()=>{
  const record={id:'s',project_id:'p'},node={id:'c',project_id:'p'},edge={id:'e',project_id:'p',from_id:'c',to_id:'s',predicate:'attributedTo',provenance:{basis:'Synthetic located link'}};
  const value={project_id:'p',record,items:[{edge,node,direction:'in'}]};assert.equal(verifyContext(value,'p','s'),value);
  for(const patch of [{direction:'out'},{node:{...node,project_id:'other'}},{edge:{...edge,to_id:'wrong'}}])assert.throws(()=>verifyContext({...value,items:[{...value.items[0],...patch}]},'p','s'));
});
test('comparison refuses a different source, immutable representation, or project',()=>{
  const value={id:'d',project_id:'p',source_record_id:'s',text_body:'التفسير',text_sha256:'a'.repeat(64)};assert.equal(verifyComparisonDocument(value,'p','s','d'),value);
  for(const args of [['other','s','d'],['p','wrong','d'],['p','s','other']])assert.throws(()=>verifyComparisonDocument(value,...args));
});
test('RDF context preserves literal text and language qualifiers without HTML interpretation',()=>{
  assert.deepEqual(contextProperties({attributes:{rdf_properties:{locator:['"Section 2 \\"literal\\""@en','<https://example.invalid/source>']}}},'locator'),['Section 2 "literal"','https://example.invalid/source']);
});
