import {markdownProperties} from '../markdownProperties.js';

// One input, no separate filter controls. Quoted values retain spaces; unknown
// prose and URLs remain literal text. Frontmatter is metadata, never authority.
export function parseNoteQuery(input){
 if(new TextEncoder().encode(input).length>512)throw Error('Keep the search within 512 UTF-8 bytes.');
 const properties={},words=[];let brainName='';
 const tokens=[];let token='',quote='';
 for(let i=0;i<input.length;i++){const c=input[i];if(quote){token+=c;if(c==='\\'&&quote==='"'&&i+1<input.length)token+=input[++i];else if(c===quote)quote='';}else if(/\s/.test(c)){if(token){tokens.push(token);token='';}}else{if((c==='"'||c==="'")&&(!token||token.endsWith(':')))quote=c;token+=c;}}
 if(quote)throw Error('Close the quoted filter value.');if(token)tokens.push(token);
 for(const token of tokens){
  const match=/^([a-z_][a-z0-9_.-]*):(.+)$/i.exec(token);
  if(!match||match[2].startsWith('//')){words.push(token);continue;}
  let [,key,value]=match;key=key.toLowerCase();
  if(value.startsWith('"')){try{value=JSON.parse(value);}catch{throw Error('Close the quoted filter value.');}}
  else if(value.startsWith("'")){if(!value.endsWith("'"))throw Error('Close the quoted filter value.');value=value.slice(1,-1);}
  if(key.length>64||value.length>200||/[\x00-\x1f]/.test(value))throw Error('Use a shorter filter value.');
  if(key==='brain'){if(brainName)throw Error('Use one brain filter.');brainName=value;}
  else{if(Object.hasOwn(properties,key))throw Error('Use each property filter once.');Object.defineProperty(properties,key,{value:value.toLowerCase(),enumerable:true});}
 }
 if(Object.keys(properties).length>8)throw Error('Use no more than eight property filters.');
 return {query:words.join(' '),properties,brain_name:brainName,offset:0};
}
export function matchesNote(row,query,brainName='Personal notes'){
 const properties=markdownProperties(row.body||'');
 const raw=properties.status==='valid'?properties.doc.toJS({maxAliasCount:0}):{},entries=Object.entries(raw).map(([key,value])=>[key.toLowerCase(),value]);
 const values=new Set(entries.map(([key])=>key)).size===entries.length?Object.fromEntries(entries):{};
 return (!query.brain_name||query.brain_name.toLowerCase()===brainName.toLowerCase())&&Object.entries(query.properties).every(([key,value])=>typeof values[key]==='string'&&values[key].toLowerCase()===value)&&query.query.toLowerCase().split(/\s+/).filter(Boolean).every(word=>`${row.title||''}\n${row.body||''}`.toLowerCase().includes(word));
}
