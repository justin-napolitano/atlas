import React,{useMemo} from 'react';
import {sourceMarkdownPlan} from './sourceMarkdown.js';
import {markdownURL} from './notebookMarkdown.js';

export default function SourceMarkdown({source,renderSlice}){
 const plan=useMemo(()=>sourceMarkdownPlan(source),[source]);
 function render(node){
  if(!node.parts)return <span key={node.from+':'+node.to} hidden={node.hidden||undefined} data-source-syntax={node.hidden?'true':undefined}>{renderSlice(node.from,node.to,!!node.hidden)}</span>;
  const props={key:node.from+':'+node.type,className:'reader-md-'+node.type},children=node.parts.map(render);
  if(node.type==='heading'){props.role='heading';props['aria-level']=node.depth;props['data-depth']=node.depth;}
  if(node.type==='list')props.role='list';
  if(node.type==='listItem'){props.role='listitem';props['data-marker']=node.marker;}
  if(node.type==='table')props.role='table';
  if(node.type==='tableRow'){props.role='row';props.style={gridTemplateColumns:`repeat(${node.columns},minmax(0,1fr))`};}
  if(node.type==='tableCell')props.role='cell';
  const href=node.type==='link'&&markdownURL(node.url||'');
  return href&&/^(https?:|mailto:)/i.test(href)?<a {...props} href={href} target="_blank" rel="noopener noreferrer">{children}</a>:<span {...props}>{children}</span>;
 }
 return plan.parts.map(render);
}
