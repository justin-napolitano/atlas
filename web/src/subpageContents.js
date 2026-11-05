import {markdownBlocks} from './liveMarkdown.js';
import {frontmatterRange} from './markdownProperties.js';

export const SUBPAGES_MARKER='<!-- atlas:subpages -->';
export function tocCommandCompletion(source,cursor){
 const start=source.lastIndexOf('\n',cursor-1)+1,line=source.slice(start,cursor);
 if(!/^\/toc(?:[ \t]+subpages)?$/.test(line))return null;
 const properties=frontmatterRange(source);if(properties&&start<properties.to)return null;
 if(markdownBlocks(source).some(block=>['code','html'].includes(block.type)&&start>=block.from&&cursor<=block.to))return null;
 return {from:start,to:cursor,cursor,raw:line,kind:'toc-command',items:[{id:'subpages',title:'Insert subpage contents',insert:SUBPAGES_MARKER+'\n\n'}]};
}
/** Only the exact standalone comment becomes a safe application component. */
export function remarkSubpageContents(){return tree=>{
 for(const node of tree.children||[])if(node.type==='html'&&node.value===SUBPAGES_MARKER){node.type='subpageContents';delete node.value;node.data={hName:'atlas-subpages'};}
};}
