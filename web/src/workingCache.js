/** Keep the active surface and protected work; suspend least-recently-used clean pages. */
export function warmKeys(keys,active,protectedKeys,limit=4){
  const keep=new Set(keys.filter(key=>key===active || protectedKeys.has(key)));
  for(const key of [...keys].reverse())if(keep.size<limit)keep.add(key);
  return keep;
}
const stateFor=value=>value?.current || value?.status==='conflict'?'Conflict':value?.saving || value?.pending || value?.status==='saving'?'Saving':value?.error || value?.sent || value?.status==='error'?'Save failed':'Unsaved';
export function workStatus(item,{drafts,records,passages}){
  const source=item.snapshot.selected,project=item.project,view=item.snapshot.libraryView;
  const pending=[];
  if(view==='quran'||view==='gutenberg'){
    for(const value of passages.values())if(value.server.project_id===project&&value.status!=='saved')pending.push(value);
    for(const value of drafts.values())if(value.projectId===project && ['quran','location-margin','gutenberg'].includes(value.workspaceMode))pending.push(value);
  }else if(view==='notebook'||view==='questions'){
    for(const [key,value] of drafts)if(key.startsWith('notebook:')){
      try{if(JSON.parse(key.slice('notebook:'.length))[0]===project && (!value.workspaceMode || value.workspaceMode===(view==='questions'?'questions':'notes')))pending.push(value);}catch{/* unknown keys cannot target another project */}
    }
  }else{
    const record=records.get(source);if(record?.server.project_id===project&&record.status!=='saved')pending.push(record);
    for(const value of passages.values())if(value.sourceId===source&&value.server.project_id===project&&value.status!=='saved')pending.push(value);
    for(const [key,value] of drafts){
      if((key.startsWith('notebook:')&&value.workspaceMode!=='location-margin')||key.startsWith('research-brief:'))continue;
      const target=value.sourceRecordId || value.record_id || value.sent?.record_id;
      const targetProject=value.projectId || value.project_id || value.sent?.project_id;
      if(target===source&&(!targetProject||targetProject===project))pending.push(value);
      else if(key===`capture:${item.snapshot.selectedDocument}`||key===`import:${source}`)pending.push(value);
    }
  }
  const labels=pending.map(stateFor);
  return ['Conflict','Save failed','Saving','Unsaved'].find(state=>labels.includes(state)) || '';
}
