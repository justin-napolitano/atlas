import {unified} from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';

// Layout is a projection of immutable source ranges, never normalized Markdown.
export function sourceMarkdownPlan(source){
 const ast=unified().use(remarkParse).use(remarkGfm).parse(source);
 function literal(from,to){return {type:'literal',from,to};}
 function plan(node,marker=''){
  const from=node.position?.start.offset,to=node.position?.end.offset;
  if(!Number.isInteger(from)||!Number.isInteger(to)||from>to)return null;
  const raw=source.slice(from,to),supported=['paragraph','heading','strong','emphasis','delete','inlineCode','code','list','listItem','table','tableRow','tableCell','link'];
  if(node.type==='text'||!supported.includes(node.type))return literal(from,to);
  // Decoding entities, escapes or multiline quote prefixes changes visible text.
  // Retain those subtrees literally rather than guessing a selector mapping.
  function exactText(child){if(child.type==='text')return source.slice(child.position.start.offset,child.position.end.offset)===child.value;return (child.children||[]).every(exactText);}
  if(!exactText(node))return literal(from,to);
  let children=node.children||[];
  if(node.type==='inlineCode'||node.type==='code'){
   const start=node.type==='code'?raw.indexOf('\n')+1:(raw.match(/^`+/)?.[0].length||0);
   if(start<0||node.type==='code'&&start===0||raw.slice(start,start+node.value.length)!==node.value)return literal(from,to);
   children=[{type:'text',value:node.value,position:{start:{offset:from+start},end:{offset:from+start+node.value.length}}}];
  }
  const hideGaps=['heading','strong','emphasis','delete','inlineCode','code','listItem','table','tableRow','tableCell','link'].includes(node.type),parts=[];let offset=from;
  for(const [index,child] of children.entries()){
   const next=plan(child,node.type==='list'?(node.ordered?String((node.start||1)+index)+'.':'•'):'');
   if(!next||next.from<offset||next.to>to)return literal(from,to);
   if(next.from>offset)parts.push({...literal(offset,next.from),hidden:hideGaps});
   parts.push(next);offset=next.to;
  }
  if(offset<to)parts.push({...literal(offset,to),hidden:hideGaps});
  return {type:node.type,from,to,parts,depth:node.depth,marker,url:node.url,columns:node.type==='tableRow'?children.length:null};
 }
 const parts=[];let offset=0;
 for(const child of ast.children){const node=plan(child);if(!node)continue;if(node.from>offset)parts.push(literal(offset,node.from));parts.push(node);offset=node.to;}
 if(offset<source.length)parts.push(literal(offset,source.length));
 return {type:'root',from:0,to:source.length,parts};
}
export function planText(source,node){return node.parts?node.parts.map(part=>planText(source,part)).join(''):source.slice(node.from,node.to);}

/** Linear UTF-16 to Unicode position map; source spelling is never transformed. */
export function sourceCodePointIndex(source){
 const offsets=new Uint32Array(source.length+1);let units=0,points=0;
 for(const char of source){for(let i=0;i<char.length;i++)offsets[units+i]=points;units+=char.length;offsets[units]=++points;}
 return offsets;
}
