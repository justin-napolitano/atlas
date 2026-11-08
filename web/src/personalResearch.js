import {markdownProperties} from './markdownProperties.js';
import {thoughtTypes} from './notebookClient.js';
import {recoveryFingerprint} from './recoveryQueue.js';

/** Filters inspect frontmatter; they never become authority or API classifications. */
export function parseResearchQuery(input){
 const filters=[],words=[];
 const tokens=[];let token='',quote='';
 for(let i=0;i<input.length;i++){
  const c=input[i];
  if(quote){token+=c;if(c==='\\'&&quote==='"'&&i+1<input.length)token+=input[++i];else if(c===quote)quote='';}
  else if(/\s/.test(c)){if(token){tokens.push(token);token='';}}
  else {if((c==='"'||c==="'")&&(!token||token.endsWith(':')))quote=c;token+=c;}
 }
 if(quote)throw Error('Close the quoted filter value.');if(token)tokens.push(token);
 for(const token of tokens){
  const match=/^(type|tag|tags|alias|aliases|property\.[\p{L}\p{N}_-]+):(.+)$/u.exec(token);
  if(!match){words.push(token);continue;}
  let value=match[2];
  if(value[0]==='"'){try{value=JSON.parse(value);}catch{throw Error('Close the quoted filter value.');}}
  else if(value[0]==="'"){if(!value.endsWith("'"))throw Error('Close the quoted filter value.');value=value.slice(1,-1);}
  if(!value.trim()||value.length>200)throw Error('Use a filter value between 1 and 200 characters.');
  filters.push({key:match[1].replace(/^property\./,''),value:value.toLocaleLowerCase()});
 }
 if(filters.length>8)throw Error('Use no more than eight property filters.');
 return {text:words.join(' '),filters};
}
export function matchesResearchProperties(row,filters){
 const properties=markdownProperties(row.body||'');
 if(!filters.length)return true;
 if(properties.status!=='valid')return false;
 const values=properties.doc.toJS({maxAliasCount:0});
 return filters.every(({key,value})=>{
  const raw=values[key==='tag'?'tags':key==='alias'?'aliases':key];
  return (Array.isArray(raw)?raw:[raw]).some(item=>typeof item==='string'&&item.toLocaleLowerCase()===value);
 });
}
export function writingStatus(session){
 if(session.saved)return 'Saved';
 const phase=session.queue.status.phase;
 if(phase==='conflict')return 'Changed elsewhere · compare both versions';
 if(phase==='error')return 'Save unconfirmed · writing retained';
 const fingerprint=recoveryFingerprint(session.recoveryPayload(session.row?.revision||0));
 if([...session.recoveries.values()].some(queue=>queue.confirmedFingerprint===fingerprint))return 'Recovery copy saved · note not yet saved';
 return phase==='saving'?'Saving…':session.dirty?'Unsaved writing':'New note';
}
export function stableEntryLink(href,id){
 const url=new URL(href);url.search='';url.hash='';url.searchParams.set('view','note');url.searchParams.set('entry_id',id);return url.href;
}
export function stableSourceLink(href,{recordId,projectId,documentId,annotationId,position}){
 const url=new URL(href);url.search='';url.hash='';
 for(const [key,value] of Object.entries({view:'source',record:recordId,project:projectId,document:documentId,annotation:annotationId,position}))if(value!==null&&value!==undefined&&value!=='')url.searchParams.set(key,value);
 return url.href;
}
export function downloadWriting(body,name='atlas-note.md'){
 const url=URL.createObjectURL(new Blob([body],{type:'text/markdown;charset=utf-8'})),link=document.createElement('a');
 link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
/** Restore only inspected text; keep the current identity, links and source anchor. */
export function restoreInspectedWriting(session,snapshot){
 if(!session.saved||session.row?.trashed||session.queue.busy||session.queue.sent)throw Error('Save or resolve your current writing before using an earlier revision.');
 if(typeof snapshot?.body!=='string')throw Error('This revision has no writing to restore.');
 const type=markdownProperties(snapshot.body).type;
 session.edit({body:snapshot.body,...(thoughtTypes.includes(type)&&(type!=='source_claim'||session.anchor.annotation_id)?{thought_type:type}:{})});
}
