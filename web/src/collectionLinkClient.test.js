import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyCollectionReadingLink} from './collectionLinkClient.js';

test('collection confirmation binds exact source, full quotation, verse and representation role',async()=>{
  const reading={id:'r',text:'تفسير',text_sha256:'a'.repeat(64),locator:'Q 4:59',material_kind:'translation',reference:{chapter:4,ayah_start:59,ayah_end:59}};
  const source={edition:'Named edition',source_url:'https://example.invalid/source'},sent={project_id:'p',document_id:'d'};
  const result={project_id:'p',document_id:'d',record_id:'s',annotation_id:'a',material_id:'m',reading_id:'r'};
  const annotation={id:'a',project_id:'p',document_id:'d',text_sha256:reading.text_sha256,start_pos:0,end_pos:5,exact:reading.text};
  const document={id:'d',project_id:'p',source_record_id:'s',text_body:reading.text,text_sha256:reading.text_sha256,edition:source.edition,locator:reading.locator,representation_url:source.source_url};
  const material={id:'m',project_id:'p',document_id:'d',annotation_id:'a',source_record_id:'s',text_sha256:reading.text_sha256,selected_quote:reading.text,material_kind:'translation',link_kind:'representation',...reading.reference,reference:{...reading.reference,id:'q4:59',label:'Q 4:59'}};
  const api={request:async path=>path==='reading/document' ? document : path==='reading/annotation' ? {annotation,anchor:{anchored:true}} : material};
  assert.equal(await verifyCollectionReadingLink(api,result,sent,reading,source),material);
  material.link_kind='discussion';await assert.rejects(verifyCollectionReadingLink(api,result,sent,reading,source));
  material.link_kind='representation';document.edition='Different version';await assert.rejects(verifyCollectionReadingLink(api,result,sent,reading,source));
});
