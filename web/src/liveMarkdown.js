import {unified} from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';

const parser=unified().use(remarkParse).use(remarkGfm);

/** Parse presentation ranges without serializing or rewriting the owner's Markdown. */
export function markdownBlocks(source){
  const nodes=parser.parse(source).children;
  const definitions=nodes.filter(node=>['definition','footnoteDefinition'].includes(node.type)).map(node=>source.slice(node.position.start.offset,node.position.end.offset)).join('\n\n');
  return nodes.map(node=>({from:node.position.start.offset,to:node.position.end.offset,type:node.type,
    source:source.slice(node.position.start.offset,node.position.end.offset),definitions}));
}

/** Keep source visible wherever a cursor or selection intersects a block. */
export function blockSelected(block,ranges){return ranges.some(({from,to})=>from<=block.to&&to>=block.from);}
