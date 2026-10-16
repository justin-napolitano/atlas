export function quoteCapture(projectId,document,selection){
  const characters=Array.from(document?.text_body || '');
  if(document?.project_id!==projectId || !Number.isInteger(selection?.start) || !Number.isInteger(selection?.end) || selection.start<0 || selection.end<=selection.start || selection.end-selection.start>500 || characters.slice(selection.start,selection.end).join('')!==selection.exact)throw new Error('Choose up to 500 exact characters from this project’s source.');
  return {annotation_uuid:crypto.randomUUID(),project_id:projectId,document_id:document.id,text_sha256:document.text_sha256,start:selection.start,end:selection.end,exact:selection.exact,capture_kind:'comment',mark_style:'none',body:''};
}
export function quoteMarkdown(exact,title,locator,annotationId){
  const label=[title,locator].filter(Boolean).join(' · ').slice(0,600).replaceAll('\\','\\\\').replaceAll('[','\\[').replaceAll(']','\\]').replaceAll('\n',' ');
  return exact.split('\n').map(line=>'> '+line.replace(/[\\`*_{}\[\]()#+\-.!>|~]/g,'\\$&')).join('\n')+`\n\n[${label || 'Open exact passage'}](research-passage:${encodeURIComponent(annotationId)})`;
}
