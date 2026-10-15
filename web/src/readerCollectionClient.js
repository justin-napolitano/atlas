/** Build a reviewable intake preset from a validated owner collection response.
 * @remarks Only exact source text enters the reader. Findings remain separately
 * labeled agent-prepared paraphrases. This does not save or confirm a request.
 */
export function collectionPreset(collection,reading) {
  const actual=collection?.readings?.find(row=>row.id===reading?.id);
  const source=collection?.sources?.find(row=>row.id===actual?.source_id);
  if(!source || actual!==reading || reading.wording_mode!=='quotation' || reading.review_state!=='pending' || reading.finding?.wording_mode!=='analyst_paraphrase')throw new Error('Choose an identified pending reading from this collection.');
  const provenance=`Collection ${collection.collection_id}; reading ${reading.id}; artifact ${collection.artifact_sha256}. ${source.rights.notice} Capture: ${source.evidence.method}; ${source.evidence.sha256 || 'raw source bytes unavailable; checked in web-reader content'}. Coverage: ${source.coverage} Finding (agent-prepared paraphrase, not source quotation): ${reading.finding.text} ${collection.review_limit}`;
  if(provenance.length>2000)throw new Error('Collection provenance exceeds the intake contract; preserve it before importing.');
  return {preset_id:`collection:${collection.collection_id}:${reading.id}`,preferred_record_id:source.canonical_source_record_id || '',
    title:source.title,creators:source.creators,publication:source.id==='rodwell-3434' ? 'Historical translation; digital source acknowledgement: Gutenberg catalog #3434' : source.source_url.includes('ksu.edu.sa') ? 'King Saud University online tafsir' : 'Al-Islam.org hosted excerpt',
    publication_date:source.id==='rodwell-3434' ? 'Historical translation; digital text updated 2021-01-08' : 'Not established for this online representation',language:source.language,
    accessed_on:source.accessed_on,edition:source.edition,identifier:'',source_url:source.source_url,source_role:reading.material_kind==='translation' ? 'translation' : 'commentary',
    access_status:'open',rights_status:source.rights.status==='public_domain_us' ? 'public_domain' : 'permitted_excerpt',rights_basis:source.rights.basis,
    coverage_scope:'selected_passage',intake_context:provenance,rationale:`Read this located ${reading.material_kind.replaceAll('_',' ')} for ${reading.reference.label || `Q ${reading.reference.chapter}:${reading.reference.ayah_start}`}. ${reading.source_scope}`,
    include_excerpt:true,text:reading.text,locator:reading.locator,
    preset_note:`${source.rights.notice} ${collection.review_limit} Exact quotation only; the collection's finding is a separately labeled analyst paraphrase. Inspect the source, wording and reuse basis before saving.`,confirmed:false};
}
