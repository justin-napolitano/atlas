import {verifyVerseLinkRow} from './verseLinksClient.js';

/** Confirm the source document, whole-quote anchor and typed verse target together. */
export async function verifyCollectionReadingLink(api,result,sent,reading,source){
  if(result?.project_id!==sent.project_id || result.reading_id!==reading.id || result.document_id!==sent.document_id || !result.record_id || !result.annotation_id || !result.material_id)throw new Error('The located reading link could not be confirmed.');
  const [document,bundle]=await Promise.all([api.request('reading/document',{project_id:sent.project_id,document_id:sent.document_id}),api.request('reading/annotation',{project_id:sent.project_id,annotation_id:result.annotation_id})]);
  const annotation=bundle.annotation;
  if(document.project_id!==sent.project_id || document.id!==sent.document_id || document.source_record_id!==result.record_id || document.text_body!==reading.text || document.text_sha256!==reading.text_sha256 ||
    document.edition!==source.edition || document.locator!==reading.locator || document.representation_url!==source.source_url || !bundle.anchor?.anchored || annotation?.id!==result.annotation_id || annotation.project_id!==sent.project_id || annotation.document_id!==document.id || annotation.text_sha256!==document.text_sha256 || annotation.start_pos!==0 || annotation.end_pos!==Array.from(reading.text).length || annotation.exact!==reading.text)throw new Error('The saved link did not retain the identified source quotation.');
  const material=verifyVerseLinkRow(await api.request('verses/material',{project_id:sent.project_id,material_id:result.material_id}),sent.project_id,annotation);
  if(material.id!==result.material_id || material.source_record_id!==result.record_id || material.material_kind!==reading.material_kind || material.link_kind!==(reading.material_kind==='translation' ? 'representation' : 'discussion') ||
    ['chapter','ayah_start','ayah_end'].some(key=>material[key]!==reading.reference[key]))throw new Error('The reading link did not match its verse or source role.');
  return material;
}
