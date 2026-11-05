import {unified} from 'unified';
import remarkParse from 'remark-parse';

const pattern=()=>/\[\[([^\]\n]{1,500})\]\]/g;
function escaped(text,index){let count=0;while(index>0&&text[--index]==='\\')count++;return count%2===1;}
function walk(node,source,visit){
  if(['link','linkReference','code','inlineCode','html'].includes(node.type))return;
  if(node.type==='text'){
    const raw=source.slice(node.position?.start.offset,node.position?.end.offset),matches=[...raw.matchAll(pattern())];
    let cursor=0;
    const found=[];
    for(const match of node.value.matchAll(pattern())){
      const at=matches.findIndex((item,index)=>index>=cursor&&item[0]===match[0]);if(at<0)continue;
      cursor=at+1;if(escaped(raw,matches[at].index))continue;
      const [target,...alias]=match[1].split('|');if(!target.trim())continue;
      found.push({target:target.trim(),label:alias.join('|').trim()||target.trim(),start:match.index,end:match.index+match[0].length});
    }
    visit(node,found);
  }
  else if(node.children)for(const child of node.children)walk(child,source,visit);
}
export function wikiLinks(body){const links=[];walk(unified().use(remarkParse).parse(body),body,(_,found)=>links.push(...found));return links;}
export function remarkNotebookLinks(){return (tree,file)=>walk(tree,String(file),(node,found)=>{
  if(!found.length)return;let offset=0;const children=[];
  for(const match of found){if(match.start>offset)children.push({type:'text',value:node.value.slice(offset,match.start)});children.push({type:'link',url:'notebook:'+encodeURIComponent(match.target),children:[{type:'text',value:match.label}]});offset=match.end;}
  if(offset<node.value.length)children.push({type:'text',value:node.value.slice(offset)});
  delete node.value;node.children=children;
  // Transparent inline grouping: mdast permits text children in a formatting node.
  node.type='emphasis';node.data={hName:'span'};
});}
export function resolveWiki(target,notes,{complete=true}={}){
  const byId=notes.find(note=>note.id===target);if(byId)return {note:byId,state:'resolved'};
  if(!complete)return {note:null,state:'incomplete'};
  const candidates=notes.filter(note=>note.title===target);
  return candidates.length===1?{note:candidates[0],state:'resolved'}:{note:null,state:candidates.length?'ambiguous':'unresolved'};
}
export function notebookGraph(notes,{complete=true}={}){
  const edges=[],unresolved=[];
  for(const note of notes){
    for(const link of note.links || [])if(link.kind==='entry'&&notes.some(row=>row.id===link.id))edges.push({from:note.id,to:link.id,label:'explained link',rationale:link.rationale});
    for(const link of wikiLinks(note.body)){const result=resolveWiki(link.target,notes,{complete});if(result.note)edges.push({from:note.id,to:result.note.id,label:'wiki link',rationale:`[[${link.target}]]`});else unresolved.push({from:note.id,...link,state:result.state});}
  }
  const seen=new Set();return {nodes:notes.map(note=>({id:note.id,label:note.title,type:note.thought_type==='question'?'question':'note',summary:note.body.slice(0,250)})),edges:edges.filter(edge=>{const key=JSON.stringify([edge.from,edge.to,edge.label]);if(seen.has(key))return false;seen.add(key);return true;}),unresolved};
}
export function markdownURL(url){return /^(https?:|mailto:|notebook:|research-passage:|#)/i.test(url)?url:'';}
