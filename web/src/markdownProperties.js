import {parseDocument,isAlias,isCollection,isPair,isScalar} from 'yaml';
import {thoughtTypes} from './notebookClient.js';
import {markdownBlocks} from './liveMarkdown.js';

// Source ranges, never a reserialized document: comments and unknown fields survive.
export function frontmatterRange(source){
 const first=/^---[ \t]*\r?\n/.exec(source);if(!first)return null;
 const close=/^(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/gm;close.lastIndex=first[0].length;
 const match=close.exec(source);
 return {from:0,start:first[0].length,end:match?.index??source.length,to:match?match.index+match[0].length:source.length,closed:!!match};
}
export function markdownProperties(source){
 const range=frontmatterRange(source);if(!range)return {status:'absent',range:null,tags:[],aliases:[]};
 if(!range.closed||range.end>8192)return {status:'unfinished',range,tags:[],aliases:[]};
 try{
  const doc=parseDocument(source.slice(range.start,range.end),{schema:'failsafe',uniqueKeys:true});
  let count=0;
  function bounded(node,depth=0){
   if(++count>512||depth>8||isAlias(node))throw Error('Unsupported properties');
   if(isCollection(node))node.items.forEach(item=>bounded(item,depth+1));
   if(isPair(node)){bounded(node.key,depth+1);bounded(node.value,depth+1);}
  }
  bounded(doc.contents);
  if(doc.errors.length||doc.warnings.length)throw Error('Unfinished properties');
  const values=doc.toJS({maxAliasCount:0});
  if(!values||Array.isArray(values)||typeof values!=='object')throw Error('Properties must be a map');
  const list=value=>(Array.isArray(value)?value:typeof value==='string'?[value]:[]).filter(v=>typeof v==='string'&&v.length<=100).slice(0,50);
  return {status:'valid',range,type:thoughtTypes.includes(values.type)?values.type:null,tags:list(values.tags),aliases:list(values.aliases),doc};
 }catch{return {status:'invalid',range,tags:[],aliases:[]};}
}
export function propertyTypeChange(source,type){
 const properties=markdownProperties(source);
 if(properties.status==='absent')return source;
 if(properties.status!=='valid')return null;
 const pair=properties.doc.contents.items.find(item=>item.key?.value==='type');
 if(!pair)return source.slice(0,properties.range.end)+`type: ${type}\n`+source.slice(properties.range.end);
 if(!isScalar(pair.value)||!pair.value.range)return null;
 const [from,to]=pair.value.range,base=properties.range.start;
 return source.slice(0,base+from)+type+source.slice(base+to);
}
export function propertyCompletion(source,cursor,notes=[]){
 const range=frontmatterRange(source);if(!range||cursor<range.start||cursor>range.end)return null;
 const start=source.lastIndexOf('\n',cursor-1)+1,line=source.slice(start,cursor);
 const result=(from,query,values)=>({from,to:cursor,cursor,raw:source.slice(from,cursor),kind:'property',items:values.filter(v=>v.toLowerCase().startsWith(query.toLowerCase())).slice(0,12).map(value=>({id:value,title:value,insert:value}))});
 const type=/^type:[ \t]*([a-z_]*)$/.exec(line);
 if(type)return result(cursor-type[1].length,type[1],thoughtTypes.filter(value=>value!==type[1]));
 const tags=/^tags:[ \t]*\[?(?:[^\]\n]*,[ \t]*)?([\p{L}\p{N}_/-]*)$/u.exec(line);
 if(tags){const known=[...new Set(notes.flatMap(note=>markdownProperties(note.body||'').tags))].sort();return result(cursor-tags[1].length,tags[1],known);}
 const key=/^([a-z]*)$/.exec(line);
 if(key&&key[1])return result(start,key[1],['type: ','tags: []','aliases: []'].filter(v=>!new RegExp('^'+v.split(':')[0]+':','m').test(source.slice(range.start,range.end))));
 return null;
}
export function frontmatterEdit(source,type='note'){
 const properties=markdownProperties(source);
 if(properties.range){const pair=properties.doc?.contents.items.find(item=>item.key?.value==='type'),range=pair?.value?.range;return {selection:range?{anchor:properties.range.start+range[0],head:properties.range.start+range[1]}:{anchor:properties.range.start},scrollIntoView:true};}
 const insert=`---\ntype: ${type}\ntags: []\n---\n\n`;
 return {changes:{from:0,insert},selection:{anchor:10,head:10+type.length},scrollIntoView:true};
}

/** A standalone /type command is an editing action, never saved as metadata. */
export function typeCommandCompletion(source,cursor){
 const start=source.lastIndexOf('\n',cursor-1)+1,line=source.slice(start,cursor);
 const match=/^[ \t]*\/t(?:y(?:p(?:e)?)?)?(?:[ \t]+([a-z_]*))?$/.exec(line);
 if(!match)return null;
 const properties=markdownProperties(source);
 if(properties.range&&(properties.status!=='valid'||start<properties.range.to))return null;
 if(markdownBlocks(source).some(block=>['code','html'].includes(block.type)&&start>=block.from&&cursor<=block.to))return null;
 const from=start+line.indexOf('/'),prefix=match[1]||'';
 return {from,to:cursor,cursor,raw:source.slice(from,cursor),kind:'type-command',items:thoughtTypes.filter(type=>type!=='source_claim'&&type.startsWith(prefix)).map(type=>({id:type,title:type.replaceAll('_',' '),insert:type}))};
}
export function typeCommandEdit(source,query,type){
 if(!thoughtTypes.includes(type)||type==='source_claim'||source.slice(query.from,query.to)!==query.raw)return null;
 const properties=markdownProperties(source);
 if(properties.range&&properties.status!=='valid')return null;
 const next=propertyTypeChange(source,type);
 if(properties.range&&next===source)return {changes:{from:query.from,to:query.to,insert:''},selection:{anchor:query.from},scrollIntoView:true};
 // Apply two edits atomically so text between properties and command keeps its
 // selection mapping and a single undo restores both the command and metadata.
 let metadata;
 if(!properties.range)metadata={from:0,insert:`---\ntype: ${type}\n---\n\n`};
 else{let from=0;while(from<source.length&&source[from]===next[from])from++;let to=source.length,end=next.length;while(to>from&&end>from&&source[to-1]===next[end-1]){to--;end--;}metadata={from,to,insert:next.slice(from,end)};}
 const added=metadata.insert.length-((metadata.to??metadata.from)-metadata.from);
 return {changes:[metadata,{from:query.from,to:query.to,insert:''}],selection:{anchor:query.from+added},scrollIntoView:true};
}
