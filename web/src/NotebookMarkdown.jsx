import React,{useId,useState} from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {frontmatterRange} from './markdownProperties.js';
import remarkFrontmatter from 'remark-frontmatter';
import {markdownURL,remarkNotebookLinks,resolveWiki} from './notebookMarkdown.js';

function NoteImage({src,alt}){const [loaded,setLoaded]=useState(false);if(!/^https?:\/\//i.test(src || ''))return <span>{alt || 'Image unavailable'}</span>;
  return loaded?<img src={src} alt={alt || ''} referrerPolicy="no-referrer" loading="lazy"/>:<button type="button" className="notebook-image-load" onClick={()=>setLoaded(true)}>Load image: {alt || 'external image'}</button>;}
export default function NotebookMarkdown({body,notes=[],onOpen,onOpenPassage,onWikiOpen,complete=true}){
  const frontmatter=frontmatterRange(body);
  const prefix='notebook-'+useId().replaceAll(':','')+'-';
  return <div className="notebook-markdown" dir="auto">{frontmatter&&<pre className="markdown-properties" aria-label="Markdown properties">{body.slice(frontmatter.start,frontmatter.end)}</pre>}<Markdown remarkPlugins={[remarkGfm,remarkFrontmatter,remarkNotebookLinks]} skipHtml remarkRehypeOptions={{clobberPrefix:prefix}} urlTransform={markdownURL} components={{
    h2:({id,className,children})=><h2 id={id==='footnote-label'?prefix+'footnote-label':id} className={className}>{children}</h2>,
    a:({href,children,...attributes})=>{if(href?.startsWith('research-passage:')){let id;try{id=decodeURIComponent(href.slice(17));}catch{return <span>{children}</span>;}return <button className="notebook-wikilink" type="button" onClick={()=>onOpenPassage?.(id)} disabled={!onOpenPassage}>{children}</button>;}if(href?.startsWith('notebook:')){let target;try{target=decodeURIComponent(href.slice(9));}catch{return <span>{children}</span>;}if(onWikiOpen)return <button className="notebook-wikilink" type="button" onClick={()=>onWikiOpen(target)}>{children}</button>;const result=resolveWiki(target,notes,{complete});return result.note?<button className="notebook-wikilink" type="button" disabled={!onOpen} onClick={()=>onOpen?.(result.note.id)}>{children}</button>:<span className="notebook-unresolved" title={result.state==='ambiguous'?'More than one note has this title. Insert a stable ID link.':'No unique active note in the loaded notebook. Save or create the target note first.'}>{children} <small>({result.state})</small></span>;}
      return href?<a href={href} aria-describedby={attributes['aria-describedby']==='footnote-label'?prefix+'footnote-label':undefined} target={href.startsWith('#')?undefined:'_blank'} rel="noopener noreferrer">{children}</a>:<span>{children}</span>;},
    img:({src,alt})=><NoteImage key={src} src={src} alt={alt}/>,
  }}>{frontmatter?body.slice(frontmatter.to):body}</Markdown></div>;
}
