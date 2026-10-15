import React,{useEffect,useRef,useState} from 'react';
import ResizablePanes from './ResizablePanes.jsx';
import {verifyComparisonDocument} from './readingContext.js';
import './readingContext.css';

/** Independent edition-bound text panes; alignment is an explicit reader judgment. */
export default function ReadingComparison({api,projectId,initialLeft,initialRight,onOpen,onClose,onSelection}){
  const [sources,setSources]=useState([]),[cursor,setCursor]=useState(null),[message,setMessage]=useState('');
  const generation=useRef(0);
  async function load(append=false){const token=++generation.current;
    try{const value=await api.request('records',{project_id:projectId,limit:50,...(append && cursor ? {cursor} : {})});
      if(value.items.some(row=>row.project_id!==projectId))throw new Error('The source list did not match this project.');
      if(token===generation.current){setSources(old=>append ? [...new Map([...old,...value.items].filter(row=>['source','work','edition'].includes(row.kind)).map(row=>[row.id,row])).values()] : value.items.filter(row=>['source','work','edition'].includes(row.kind)));setCursor(value.next_cursor);}}
    catch(error){if(token===generation.current)setMessage(error.message);}
  }
  useEffect(()=>{setSources([]);setCursor(null);load();return()=>{generation.current++;};},[projectId]);
  return <section className="reading-comparison" aria-labelledby="comparison-heading"><header><h2 id="comparison-heading">Read side by side</h2><button onClick={onClose}>Back to my reading</button></header>
    <p>Choose each source and saved edition independently. Scrolling is independent; matching verse numbers do not make translations or interpretations equivalent.</p>
    {message && <p role="alert">{message}</p>}{cursor && <button onClick={()=>load(true)}>Load more source choices</button>}
    <ResizablePanes storageKey="research:comparison-width" className="comparison-panes" label="Resize comparison panes">
      <ComparisonPane key={projectId+':left'} label="Left reading" api={api} projectId={projectId} sources={sources} initialTarget={initialLeft} onOpen={onOpen} onSelection={value=>onSelection?.('left',value)}/>
      <ComparisonPane key={projectId+':right'} label="Right reading" api={api} projectId={projectId} sources={sources} initialTarget={initialRight} onOpen={onOpen} onSelection={value=>onSelection?.('right',value)}/>
    </ResizablePanes>
  </section>;
}

function ComparisonPane({label,api,projectId,sources,initialTarget,onOpen,onSelection}){
  const [source,setSource]=useState(initialTarget?.record_id || ''),[documents,setDocuments]=useState([]),[documentId,setDocumentId]=useState(initialTarget?.document_id || ''),[cursor,setCursor]=useState(null);
  const [document,setDocument]=useState(null),[message,setMessage]=useState('');const generation=useRef(0),documentGeneration=useRef(0);
  async function loadDocuments(append=false){const token=++generation.current;if(!source)return;
    try{const value=await api.request('reading/documents',{project_id:projectId,source_record_id:source,limit:25,...(append && cursor ? {cursor} : {})});
      if(value.items.some(row=>row.project_id!==projectId || row.source_record_id!==source))throw new Error('Versions did not match the selected source.');
      if(token===generation.current){setDocuments(old=>append ? [...old,...value.items] : value.items);setCursor(value.next_cursor);if(!append)setDocumentId(old=>initialTarget?.record_id===source && old ? old : value.items[0]?.id || '');}}
    catch(error){if(token===generation.current)setMessage(error.message);}
  }
  useEffect(()=>{setDocument(null);setDocuments([]);setCursor(null);setMessage('');loadDocuments();return()=>{generation.current++;};},[source]);
  useEffect(()=>{const token=++documentGeneration.current;setDocument(null);setMessage('');if(!source || !documentId)return;
    api.request('reading/document',{project_id:projectId,document_id:documentId}).then(value=>verifyComparisonDocument(value,projectId,source,documentId)).then(value=>{if(token===documentGeneration.current){setDocument(value);onSelection?.({record_id:source,document_id:documentId});}}).catch(error=>{if(token===documentGeneration.current)setMessage(error.message);});
    return()=>{documentGeneration.current++;};
  },[source,documentId]);
  const known=sources.some(row=>row.id===source);
  return <section className="comparison-pane" aria-label={label}><h3>{label}</h3>
    <label>Source<select value={source} onChange={event=>{setDocumentId('');setSource(event.target.value);}}><option value="">Choose a source</option>{source && !known && <option value={source}>Selected source · {source}</option>}{sources.map(row=><option key={row.id} value={row.id}>{row.title}</option>)}</select></label>
    {source && <label>Saved version<select value={documentId} onChange={event=>setDocumentId(event.target.value)}><option value="">Choose a saved excerpt</option>{documentId && !documents.some(row=>row.id===documentId) && <option value={documentId}>Selected saved version</option>}{documents.map(row=><option key={row.id} value={row.id}>{row.edition} · {row.locator}</option>)}</select></label>}
    {cursor && <button onClick={()=>loadDocuments(true)}>More saved versions</button>}{message && <p role="alert">{message}</p>}
    {source && !documents.length && !document && !message && <p>No loaded excerpt yet. Add an identified source excerpt from the reading library.</p>}
    {document && <><p>{document.edition} · {document.locator}<br/><small>Source version {document.text_sha256.slice(0,12)} · {document.review_scope}</small></p>
      {document.source_notice && <details><summary>Source notice & attribution</summary><pre dir="auto">{document.source_notice}</pre></details>}
      <div className="comparison-text" tabIndex={0} dir="auto">{document.text_body}</div>
      <button onClick={()=>onOpen(source,projectId,'',document.id)}>Open this version & annotate</button></>}
  </section>;
}
