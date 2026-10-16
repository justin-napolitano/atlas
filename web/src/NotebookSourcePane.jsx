import React,{useEffect,useState} from 'react';
import SourceReader from './SourceReader.jsx';

/** Keep source navigation inside the writing surface, without changing its page route. */
export default function NotebookSourcePane({api,projectId,target,drafts,changed,noteEditor,onNavigate,onClose,onExpand,onQuote,hidden=false}){
  const [record,setRecord]=useState(null),[error,setError]=useState('');
  const [place,setPlace]=useState(null);
  useEffect(()=>{let active=true;setRecord(null);setError('');setPlace(null);
    api.request('record',{project_id:projectId,record_id:target.recordId}).then(value=>{if(value.project_id!==projectId || value.id!==target.recordId)throw new Error('The source did not match this project.');if(active)setRecord(value);}).catch(err=>{if(active)setError(err.message || 'Could not open this source.');});
    return()=>{active=false;};},[api,projectId,target.recordId]);
  return <aside hidden={hidden} data-contained-reader className="notebook-source-pane" aria-label="Source beside notebook">
    <header><span>Alongside your notes</span><button onClick={onClose} aria-label="Close source panel">Close source ×</button></header>
    {error && <p role="alert">{error}</p>}{!error&&!record&&<p role="status">Opening the source…</p>}
    {record && <><h3 dir="auto">{record.title}</h3><button className="notebook-source-expand" onClick={()=>onExpand?.(record.id,projectId,place?.annotation_id || target.annotationId,place?.document_id || target.documentId)}>Open full reader ↗</button>
      {['source','work','edition'].includes(record.kind)?<SourceReader key={JSON.stringify([projectId,target.recordId,target.annotationId,target.documentId])} record={record} api={api} drafts={drafts} changed={changed} noteEditor={noteEditor} navigate={onNavigate} initialDocumentId={target.documentId} initialAnnotationId={target.annotationId} initialMarginOpen={false} onBookmark={setPlace} onReadingPlace={setPlace} onQuote={onQuote}/>:<p>{record.summary || 'No summary recorded.'}</p>}
    </>}
  </aside>;
}
