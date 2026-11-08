import {wikiLinks} from '../notebookMarkdown.js';
import {frontmatterRange} from '../markdownProperties.js';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function readNoteLink(href=location.href){const params=new URL(href).searchParams,brain=params.get('brain'),page=params.get('page');return uuid.test(brain||'')&&uuid.test(page||'')?{brain,page}:null;}
export function stableNoteLink(href,brain,page){if(!uuid.test(brain)||!uuid.test(page))throw Error('Invalid note link');const url=new URL(href);url.searchParams.set('collaboration','1');url.searchParams.delete('account');url.searchParams.set('brain',brain);url.searchParams.set('page',page);return url.href;}
// Links use durable page IDs. Display labels can change without changing targets.
export function noteReferences(body,pages){
 const out=[],range=frontmatterRange(body);
 for(const {target,label} of wikiLinks(range?body.slice(range.to):body)){
  const matches=pages.filter(row=>row.page_id===target||row.content.title===target);
  if(matches.length===1)out.push({id:matches[0].page_id,label:label===target?matches[0].content.title:label});
 }
 return [...new Map(out.map(row=>[row.id,row])).values()];
}
