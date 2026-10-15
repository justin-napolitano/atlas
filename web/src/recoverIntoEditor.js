/** Recover explicit private writing into an editor, never into the saved note. */
export function recoverRecordWriting(store,record,recovered){
  const entry=store.entries.get(record.id),current=recovered.current_snapshot;
  if(recovered.project_id!==record.project_id || recovered.record_id!==record.id || recovered.context_kind!=='record_note' ||
    !entry || entry.pending || !current || !Number.isInteger(current.revision) || current.revision<0 ||
    (current.record_id && current.record_id!==record.id) || (current.project_id && current.project_id!==record.project_id))return false;
  entry.server={...entry.server,...current};entry.current=null;
  entry.draft={record_id:record.id,project_id:record.project_id,reading:current.reading || entry.server.reading,
    decision:current.decision || entry.server.decision,note:recovered.body};
  entry.status=entry.draft.note===entry.server.note ? 'saved' : 'unsaved';store.changed();return true;
}

/** Keep the actual annotation's current CAS baseline while restoring private text. */
export function recoverPassageWriting(editor,record,recovered){
  const current=recovered.current_snapshot;
  if(recovered.project_id!==record.project_id || recovered.record_id!==record.id || !current ||
    !['capture','annotation'].includes(recovered.context_kind) ||
    current.project_id!==record.project_id || current.document_id!==recovered.document_id || current.text_sha256!==recovered.text_sha256 ||
    current.start_pos!==recovered.start || current.end_pos!==recovered.end || current.exact!==recovered.exact ||
    (recovered.context_kind==='capture' && current.id!=='urn:research:annotation:'+recovered.annotation_uuid) ||
    (recovered.context_kind==='annotation' && current.id!==recovered.annotation_id))return false;
  const existing=editor.entries.get(current.id);if(existing?.pending || existing?.uncertain)return false;
  const entry=editor.adopt(current,record.id);entry.server=current;entry.current=null;entry.uncertain=false;
  entry.body=recovered.body;entry.markStyle=recovered.mark_style;entry.open=true;
  entry.status=entry.body===current.body && entry.markStyle===(current.mark_style || 'highlight') ? 'saved' : 'unsaved';editor.changed();return true;
}
