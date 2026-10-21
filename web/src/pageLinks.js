import {unified} from 'unified';
import remarkParse from 'remark-parse';
import {wikiLinks} from './notebookMarkdown.js';

export const PAGE_LINK_REASON='Markdown page link';
export function wikiCompletion(source,cursor){
 if(!Number.isInteger(cursor)||cursor<0||cursor>source.length)return null;
 const line=source.slice(source.lastIndexOf('\n',cursor-1)+1,cursor),match=/\[\[([^\[\]\n|]{0,200})$/.exec(line);
 if(!match)return null;
 const from=cursor-match[0].length;let slashes=0;for(let i=from-1;i>=0&&source[i]==='\\';i--)slashes++;
 if(slashes%2)return null;
 let blocked=false;
 function walk(node){
  const start=node.position?.start.offset,end=node.position?.end.offset;
  if(start==null||end==null||from<start||cursor>end)return;
  if(['code','inlineCode','html','link','linkReference','definition','image','imageReference'].includes(node.type)){blocked=true;return;}
  node.children?.forEach(walk);
 }
 walk(unified().use(remarkParse).parse(source));
 if(blocked)return null;
 const to=source.slice(cursor,cursor+2)===']]'?cursor+2:cursor;
 return {from,to,cursor,query:match[1],raw:source.slice(from,to)};
}
export function pageWikiText(page){
 const label=String(page.title||'Untitled page').replace(/[\[\]|\r\n]/g,' ').trim();
 return `[[${page.id}|${label}]]`;
}
/** Preserve manually explained links; generated navigation links follow actual Markdown. */
export function pageLinksFor(body,existing=[],picked=null,remembered=new Set()){
 const manual=existing.filter(link=>!(link.kind==='entry'&&link.rationale===PAGE_LINK_REASON));
 const known=remembered;for(const link of existing)if(link.kind==='entry')known.add(link.id);if(picked)known.add(picked.id);
 const seen=new Set(manual.map(link=>JSON.stringify([link.kind,link.id]))),generated=[];
 for(const {target} of wikiLinks(body)){
  const key=JSON.stringify(['entry',target]);if(!known.has(target)||seen.has(key))continue;
  seen.add(key);generated.push({kind:'entry',id:target,rationale:PAGE_LINK_REASON});
 }
 // Keep the existing explicit-reference request budget; raw Markdown is never lost.
 return [...manual,...generated].slice(0,25);
}
