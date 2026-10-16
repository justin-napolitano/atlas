/** Translate verified retrieval identities into existing explicit notebook link types. */
export function notebookConnection(row) {
  if (row.kind === 'thought' && row.entry_id) return {kind:'entry',id:row.entry_id};
  if (['passage_note','definition'].includes(row.kind) && row.annotation_id) return {kind:'annotation',id:row.annotation_id};
  if (row.kind === 'concept' && (row.concept_id || row.record_id)) return {kind:'record',id:row.concept_id || row.record_id};
  if (row.record_id) return {kind:'record',id:row.record_id};
  return null;
}
