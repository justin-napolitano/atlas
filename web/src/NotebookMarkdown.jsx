import React,{useState} from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {markdownURL,remarkNotebookLinks,resolveWiki} from './notebookMarkdown.js';

function NoteImage({src,alt}){const [loaded,setLoaded]=useState(false);if(!/^https?:\/\//i.test(src || ''))return <span>{alt || 'Image unavailable'}</span>;
  return loaded?<img src={src} alt={alt || ''} referrerPolicy="no-referrer" loading="lazy"/>:<button type="button" className="notebook-image-load" onClick={()=>setLoaded(true)}>Load image: {alt || 'external image'}</button>;}
export default function NotebookMarkdown({body,notes,onOpen,onOpenPassage,complete=true}){
  return <div className="notebook-markdown" dir="auto"><Markdown remarkPlugins={[remarkGfm,remarkNotebookLinks]} skipHtml urlTransform={markdownURL} components={{
    a:({href,children})=>{if(href?.startsWith('research-passage:')){let id;try{id=decodeURIComponent(href.slice(17));}catch{return <span>{children}</span>;}return <button className="notebook-wikilink" type="button" onClick={()=>onOpenPassage?.(id)} disabled={!onOpenPassage}>{children}</button>;}if(href?.startsWith('notebook:')){let target;try{target=decodeURIComponent(href.slice(9));}catch{return <span>{children}</span>;}const result=resolveWiki(target,notes,{complete});return result.note?<button className="notebook-wikilink" type="button" onClick={()=>onOpen(result.note.id)}>{children}</button>:<span className="notebook-unresolved" title={result.state==='ambiguous'?'More than one note has this title. Insert a stable ID link.':'No unique active note in the loaded notebook. Save or create the target note first.'}>{children} <small>({result.state})</small></span>;}
      return href?<a href={href} target={href.startsWith('#')?undefined:'_blank'} rel="noopener noreferrer">{children}</a>:<span>{children}</span>;},
    img:({src,alt})=><NoteImage key={src} src={src} alt={alt}/>,
  }}>{body}</Markdown></div>;
}
