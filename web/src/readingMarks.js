/**
 * Split immutable source text into non-overlapping runs for saved annotations.
 * Positions are Unicode code points. A stale selector is omitted rather than
 * moved to a similar occurrence; overlapping notes remain independently linked.
 * @returns {{runs: Array, unanchored: Array}} Original text runs and rejected notes.
 */
export function readingMarks(document, annotations, selection = null) {
  const characters=Array.from(document.text_body), marks=[], unanchored=[];
  for(const row of annotations) {
    if(row.project_id!==document.project_id || row.document_id!==document.id || row.text_sha256!==document.text_sha256 ||
       !Number.isInteger(row.start_pos) || !Number.isInteger(row.end_pos) || row.start_pos<0 || row.start_pos>=row.end_pos ||
       row.end_pos>characters.length || characters.slice(row.start_pos,row.end_pos).join('')!==row.exact) {
      unanchored.push(row.id); continue;
    }
    marks.push({id:row.id,start:row.start_pos,end:row.end_pos,style:['underline','none'].includes(row.mark_style) ? row.mark_style : 'highlight'});
  }
  const active=selection && Number.isInteger(selection.start) && Number.isInteger(selection.end) && selection.start>=0 &&
    selection.start<selection.end && selection.end<=characters.length ? selection : null;
  const boundaries=[...new Set([0,characters.length,...marks.flatMap(row=>[row.start,row.end]),...(active ? [active.start,active.end] : [])])].sort((a,b)=>a-b);
  const runs=[];
  for(let index=0;index<boundaries.length-1;index++) {
    const start=boundaries[index],end=boundaries[index+1],included=marks.filter(row=>row.start<=start && row.end>=end);
    runs.push({start,end,text:characters.slice(start,end).join(''),ids:included.map(row=>row.id),
      underline:included.some(row=>row.style==='underline'),highlight:included.some(row=>row.style==='highlight'),
      selected:!!active && active.start<=start && active.end>=end});
  }
  return {runs,unanchored};
}

/** Accept a create response only when it identifies the exact submitted capture. */
export function verifyReadingCapture(row, sent) {
  if(!row || row.id!==`urn:research:annotation:${sent.annotation_uuid}` || row.project_id!==sent.project_id ||
    row.document_id!==sent.document_id || row.text_sha256!==sent.text_sha256 || row.start_pos!==sent.start ||
    row.end_pos!==sent.end || row.exact!==sent.exact || row.capture_kind!==sent.capture_kind ||
    row.body!==sent.body || !Number.isInteger(row.revision) || row.revision<1 ||
    (sent.mark_style && row.mark_style!==sent.mark_style)) throw new Error('The saved response did not match this passage. Your draft remains available.');
  return row;
}
